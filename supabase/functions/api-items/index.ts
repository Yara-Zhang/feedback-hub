// 反馈条目 API
// GET  /list        列表 + 统计（支持 market / claim_user_id=me 筛选）
// GET  /:id         详情（含回复草稿）
// POST /:id/claim   认领（并发安全：条件更新）
// POST /:id/status  状态流转（new/claimed/replied/skipped，仅认领人或管理员；replied 可回填链接、skipped 可写原因）
// POST /:id/material 收藏/取消收藏宣发素材
// POST /recheck    批量复查已回复条目的最新互动数（admin）
// GET  /hot         Part A 热点：按话题聚合 + 高互动排序
// GET  /me          当前用户信息
// GET  /users/list  成员列表（admin）
// POST /users/role  设置角色（admin）
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { restSelect, restPatch, restRpc, restInsert } from '../_shared/rest.ts'
import type { SessionPayload } from '../_shared/jwt.ts'

// 互动总数（热点排序用）
function engagement(m: Record<string, number> | null | undefined): number {
  if (!m) return 0
  return ['like_count', 'liked_count', 'digg_count', 'comment_count', 'repost_count', 'share_count', 'view']
    .reduce((s, k) => s + (Number(m[k]) || 0), 0)
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path, url } = fnPath(req, 'api-items')

  try {
    const session = await requireUser(req)

    // ---------- 列表 ----------
    if (path === '/list' && req.method === 'GET') {
      const p = url.searchParams
      const page = Math.max(1, Number(p.get('page') || 1))
      const pageSize = Math.min(100, Math.max(5, Number(p.get('page_size') || 20)))
      const q = (p.get('q') || '').trim()

      const filters: Record<string, string> = {}
      const map: [string, string][] = [
        ['platform', 'platform'], ['part_type', 'part_type'], ['ai_scene', 'ai_scene'],
        ['content_type', 'content_type'], ['ai_priority', 'ai_priority'], ['market', 'market'],
        ['ai_sentiment', 'ai_sentiment'], ['ai_topic', 'ai_topic'],
      ]
      for (const [param, col] of map) {
        const v = p.get(param)
        if (v) filters[col] = `eq.${v}`
      }
      const tags = p.get('tags')
      if (tags) filters['ai_tags_json'] = `cs.["${tags}"]`
      const status = p.get('status')
      if (status) filters['status'] = `in.(${status.split(',').join(',')})`
      if (p.get('claim_user_id') === 'me') filters['claim_user_id'] = `eq.${session.sub}`
      else if (p.get('claim_user_id')) filters['claim_user_id'] = `eq.${p.get('claim_user_id')}`
      if (p.get('is_material') === '1') filters['is_material'] = 'eq.true'
      if (p.get('include_skipped') !== '1') filters['ai_status'] = 'neq.skipped'
      if (q) filters['or'] = `(content_text.ilike.*${q.replace(/[(),]/g, ' ')}*,author_name.ilike.*${q.replace(/[(),]/g, ' ')}*)`

      const params: Record<string, string | number> = {
        select: '*,claim_user:users!feedback_items_claim_user_id_fkey(name)',
        order: 'created_at.desc',
        limit: pageSize,
        offset: (page - 1) * pageSize,
        ...filters,
      }
      const { data, count } = await restSelect<Record<string, unknown>>('feedback_items', params, { count: true })
      const items = data.map((it) => {
        const claim = (it.claim_user as { name?: string } | null)
        delete it.claim_user
        return { ...it, claim_name: claim?.name || null }
      })

      // ---------- 空结果诊断（如实告知"是排队中还是真没有"） ----------
      let emptyContext: Record<string, unknown> | null = null
      if (count === 0) {
        // a) 基础条件（平台/来源/类型/关键词）相同、但尚未 AI 打标的条数——场景/优先级筛选要等打标后才生效
        const baseParams: Record<string, string | number> = {
          select: 'id', ai_status: 'eq.pending', limit: 1,
        }
        if (filters.platform) baseParams.platform = filters.platform
        if (filters.part_type) baseParams.part_type = filters.part_type
        if (filters.content_type) baseParams.content_type = filters.content_type
        if (q) baseParams.or = `(content_text.ilike.*${q.replace(/[(),]/g, ' ')}*,author_name.ilike.*${q.replace(/[(),]/g, ' ')}*)`
        const { count: pendingTagging } = await restSelect('feedback_items', baseParams, { count: true })

        // b) 抓取任务队列（若选了平台，看该平台；否则看总量）与最近入库时间
        const jobParams: Record<string, string | number> = { select: 'id', status: 'eq.pending', limit: 1 }
        if (filters.platform) jobParams.platform = filters.platform
        const { count: queuedJobs } = await restSelect('crawl_jobs', jobParams, { count: true })

        const lastParams: Record<string, string | number> = {
          select: 'created_at', order: 'created_at.desc', limit: 1,
        }
        if (filters.platform) lastParams.platform = filters.platform
        const { data: lastRow } = await restSelect<{ created_at: string }>('feedback_items', lastParams, { single: true })

        emptyContext = {
          pending_tagging: pendingTagging || 0,
          queued_jobs: queuedJobs || 0,
          last_item_at: lastRow?.[0]?.created_at || null,
        }
      }

      const stats = await restRpc<Record<string, number>>('dashboard_stats')
      return json({ items, total: count, stats, ...(emptyContext ? { empty_context: emptyContext } : {}) })
    }

    // ---------- 详情 ----------
    const idMatch = path.match(/^\/(\d+)$/)
    if (idMatch && req.method === 'GET') {
      const id = idMatch[1]
      const { data } = await restSelect<Record<string, unknown>>('feedback_items', {
        select: '*,claim_user:users!feedback_items_claim_user_id_fkey(name)', id: `eq.${id}`,
      }, { single: true })
      if (!data?.length) return err('反馈不存在', 404)
      const item = { ...data[0], claim_name: ((data[0].claim_user as { name?: string } | null)?.name) || null }
      delete item.claim_user
      const { data: drafts } = await restSelect('reply_drafts', {
        select: '*', item_id: `eq.${id}`, order: 'created_at.desc', limit: 10,
      })
      return json({ item, drafts: drafts || [] })
    }

    // ---------- 认领 ----------
    const claimMatch = path.match(/^\/(\d+)\/claim$/)
    if (claimMatch && req.method === 'POST') {
      const id = claimMatch[1]
      const updated = await restPatch('feedback_items',
        { id: `eq.${id}`, status: 'eq.new' },
        { status: 'claimed', claim_user_id: session.sub, claim_time: new Date().toISOString() })
      if (!updated.length) return err('该反馈已被他人认领或状态已变更', 409)
      return json({ ok: true })
    }

    // ---------- 状态流转 ----------
    const statusMatch = path.match(/^\/(\d+)\/status$/)
    if (statusMatch && req.method === 'POST') {
      const id = statusMatch[1]
      const b = await body<{ status: string; reply_url?: string; skip_reason?: string }>(req)
      if (!['new', 'claimed', 'replied', 'skipped'].includes(b.status)) return err('非法状态')
      const { data: rows } = await restSelect<{ claim_user_id: number | null }>('feedback_items', {
        select: 'claim_user_id', id: `eq.${id}`,
      }, { single: true })
      if (!rows?.length) return err('反馈不存在', 404)
      const owner = rows[0].claim_user_id
      if (owner !== session.sub && session.role !== 'admin') return err('仅认领人或管理员可修改状态', 403)

      let patch: Record<string, unknown> = { status: b.status }
      if (b.status === 'replied') {
        const replyUrl = (b.reply_url || '').trim()
        if (replyUrl && !/^https?:\/\//.test(replyUrl)) return err('回复链接须以 http(s):// 开头')
        patch = { status: 'replied', ...(replyUrl ? { reply_url: replyUrl.slice(0, 1024) } : {}), replied_at: new Date().toISOString() }
      } else if (b.status === 'skipped') {
        patch = { status: 'skipped', skip_reason: (b.skip_reason || '').slice(0, 300) || null }
      } else if (b.status === 'new') {
        // reopen：清空认领与回复字段，回池待认领
        patch = { status: 'new', claim_user_id: null, claim_time: null, reply_url: null, replied_at: null, skip_reason: null }
      }
      await restPatch('feedback_items', { id: `eq.${id}` }, patch)
      return json({ ok: true })
    }

    // ---------- 素材收藏 toggle ----------
    const materialMatch = path.match(/^\/(\d+)\/material$/)
    if (materialMatch && req.method === 'POST') {
      const id = materialMatch[1]
      const { data: rows } = await restSelect<{ is_material: boolean }>('feedback_items', {
        select: 'is_material', id: `eq.${id}`,
      }, { single: true })
      if (!rows?.length) return err('反馈不存在', 404)
      const nowOn = !rows[0].is_material
      await restPatch('feedback_items', { id: `eq.${id}` }, {
        is_material: nowOn,
        ...(nowOn ? { material_by: session.sub, material_at: new Date().toISOString() } : { material_by: null, material_at: null }),
      })
      return json({ ok: true, is_material: nowOn })
    }

    // ---------- 批量复查已回复条目（回复效果追踪入队） ----------
    if (path === '/recheck' && req.method === 'POST') {
      if (session.role !== 'admin') return err('需要管理员权限', 403)
      const { data: replied } = await restSelect<{
        id: number; platform: string; source_id: string; source_url: string; extra_json: Record<string, unknown>
      }>('feedback_items', {
        select: 'id,platform,source_id,source_url,extra_json',
        status: 'eq.replied', reply_url: 'not.is.null',
        order: 'replied_at.desc', limit: 20,
      })
      let queued = 0
      for (const it of replied || []) {
        await restInsert('crawl_jobs', [{
          job_type: 'recheck',
          platform: it.platform,
          source_id: it.source_id,
          source_url: it.source_url,
          cursor_info: { item_id: it.id, extra: it.extra_json || {} },
        }])
        queued++
      }
      return json({ ok: true, queued })
    }

    // ---------- Part A 热点：话题聚合 + 高互动排序 ----------
    if (path === '/hot' && req.method === 'GET') {
      const market = url.searchParams.get('market') || ''
      const params: Record<string, string | number> = {
        select: '*,claim_user:users!feedback_items_claim_user_id_fkey(name)',
        part_type: 'eq.part_a',
        ai_status: 'neq.skipped',
        created_at: `gte.${new Date(Date.now() - 7 * 86400_000).toISOString()}`,
        limit: 1000,
      }
      if (market) params.market = `eq.${market}`
      const { data: rows } = await restSelect<Record<string, unknown>>('feedback_items', params)

      const items = (rows || []).map((it) => {
        const claim = (it.claim_user as { name?: string } | null)
        delete it.claim_user
        return {
          id: it.id, platform: it.platform, content_type: it.content_type, source_url: it.source_url,
          author_name: it.author_name, content_text: String(it.content_text || '').slice(0, 200),
          metrics_json: it.metrics_json, ai_priority: it.ai_priority, ai_sentiment: it.ai_sentiment,
          ai_topic: it.ai_topic, ai_quote: it.ai_quote, status: it.status,
          publish_time: it.publish_time, created_at: it.created_at, claim_name: claim?.name || null,
          heat: engagement(it.metrics_json as Record<string, number> | null),
        }
      })

      // 按 topic 聚合；无 topic 的按互动排序进"其他高互动"
      const groups = new Map<string, { topic: string; count: number; heat: number; items: typeof items }>()
      const untagged: typeof items = []
      for (const it of items) {
        const topic = (it.ai_topic || '').trim()
        if (!topic) { untagged.push(it); continue }
        let g = groups.get(topic)
        if (!g) { g = { topic, count: 0, heat: 0, items: [] }; groups.set(topic, g) }
        g.count++
        g.heat += it.heat
        g.items.push(it)
      }
      const sorted = [...groups.values()].sort((a, b) => b.heat - a.heat).slice(0, 30)
      for (const g of sorted) g.items = g.items.sort((a, b) => b.heat - a.heat).slice(0, 10)
      untagged.sort((a, b) => b.heat - a.heat)
      return json({ groups: sorted, untagged: untagged.slice(0, 10), total: items.length })
    }

    // ---------- 我 ----------
    if (path === '/me' && req.method === 'GET') {
      return json({ user: { id: session.sub, name: session.name, role: session.role, open_id: session.open_id } })
    }

    // ---------- 成员列表 ----------
    if (path === '/users/list' && req.method === 'GET') {
      if (session.role !== 'admin') return err('需要管理员权限', 403)
      const { data: users } = await restSelect<Record<string, unknown>>('users', { select: 'id,name,email,avatar_url,role,created_at', order: 'created_at.asc' })
      const { data: processed } = await restSelect<{ claim_user_id: number }>('feedback_items', {
        select: 'claim_user_id', status: 'eq.replied',
      })
      const counts = new Map<number, number>()
      for (const r of processed || []) counts.set(r.claim_user_id, (counts.get(r.claim_user_id) || 0) + 1)
      return json({ users: (users || []).map((u) => ({ ...u, replied_count: counts.get(Number(u.id)) || 0 })) })
    }

    // ---------- 角色设置 ----------
    if (path === '/users/role' && req.method === 'POST') {
      if (session.role !== 'admin') return err('需要管理员权限', 403)
      const b = await body<{ id: number; role: string }>(req)
      if (!['admin', 'member'].includes(b.role)) return err('非法角色')
      await restPatch('users', { id: `eq.${b.id}` }, { role: b.role })
      return json({ ok: true })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '鉴权失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '内部错误', 500)
  }
})
