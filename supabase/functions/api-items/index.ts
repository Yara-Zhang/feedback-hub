// 反馈条目 API
// GET  /list        列表 + 统计
// GET  /:id         详情（含回复草稿）
// POST /:id/claim   认领（并发安全：条件更新）
// POST /:id/status  状态流转（仅认领人或管理员）
// GET  /me          当前用户信息
// GET  /users/list  成员列表（admin）
// POST /users/role  设置角色（admin）
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { restSelect, restPatch, restRpc } from '../_shared/rest.ts'
import type { SessionPayload } from '../_shared/jwt.ts'

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
        ['content_type', 'content_type'], ['ai_priority', 'ai_priority'],
      ]
      for (const [param, col] of map) {
        const v = p.get(param)
        if (v) filters[col] = `eq.${v}`
      }
      const status = p.get('status')
      if (status) filters['status'] = `in.(${status.split(',').join(',')})`
      if (p.get('claim_user_id') === 'me') filters['claim_user_id'] = `eq.${session.sub}`
      else if (p.get('claim_user_id')) filters['claim_user_id'] = `eq.${p.get('claim_user_id')}`
      if (p.get('include_skipped') !== '1') filters['ai_status'] = 'neq.skipped'
      if (q) filters['or'] = `(content_text.ilike.*${q.replace(/[(),]/g, ' ')}*,author_name.ilike.*${q.replace(/[(),]/g, ' ')}*)`

      const params: Record<string, string | number> = {
        select: '*,claim_user:users(name)',
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
        select: '*,claim_user:users(name)', id: `eq.${id}`,
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
      const b = await body<{ status: string }>(req)
      if (!['new', 'claimed', 'processed', 'ignored'].includes(b.status)) return err('非法状态')
      const { data: rows } = await restSelect<{ claim_user_id: number | null }>('feedback_items', {
        select: 'claim_user_id', id: `eq.${id}`,
      }, { single: true })
      const owner = rows?.[0]?.claim_user_id
      if (owner !== session.sub && session.role !== 'admin') return err('仅认领人或管理员可修改状态', 403)
      await restPatch('feedback_items', { id: `eq.${id}` }, { status: b.status })
      return json({ ok: true })
    }

    // ---------- 我 ----------
    if (path === '/me' && req.method === 'GET') {
      return json({ user: { id: session.sub, name: session.name, role: session.role, open_id: session.open_id } })
    }

    // ---------- 成员列表 ----------
    if (path === '/users/list' && req.method === 'GET') {
      if (session.role !== 'admin') return err('需要管理员权限', 403)
      const { data: users } = await restSelect<Record<string, unknown>>('users', { select: 'id,name,avatar_url,role,created_at', order: 'created_at.asc' })
      const { data: processed } = await restSelect<{ claim_user_id: number }>('feedback_items', {
        select: 'claim_user_id', status: 'eq.processed',
      })
      const counts = new Map<number, number>()
      for (const r of processed || []) counts.set(r.claim_user_id, (counts.get(r.claim_user_id) || 0) + 1)
      return json({ users: (users || []).map((u) => ({ ...u, processed_count: counts.get(Number(u.id)) || 0 })) })
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
