// 个人导出 API（CSV，带 BOM，Excel 可直接打开）
// GET /export?scope=mine|all|material&token=...
//   &platform=&ai_scene=&market=...（可选过滤）
//   &range=today|this_week|this_month|custom&start=&end=（时间范围）
import { err, fnPath } from '../_shared/cors.ts'
import { verifyJwt, type SessionPayload } from '../_shared/jwt.ts'
import { restSelect } from '../_shared/rest.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || ''

const PLATFORM_NAMES: Record<string, string> = {
  xhs: '小红书', wb: '微博', bili: 'B站', dy: '抖音', x: 'X', reddit: 'Reddit', zhihu: '知乎',
}
const TYPE_NAMES: Record<string, string> = { video: '视频', note: '笔记', post: '帖子', comment: '评论' }
const PART_NAMES: Record<string, string> = { part_a: '沉浸式翻译相关', part_b: '全量场景' }
const SCENE_NAMES: Record<string, string> = { comic: '漫画', novel: '小说/AO3', video: '视频', other: '其他' }
const SENT_NAMES: Record<string, string> = { positive: '正面', neutral: '中性', negative: '负面' }
const STATUS_NAMES: Record<string, string> = { new: '待处理', claimed: '已认领', replied: '已回复', skipped: '已跳过' }
const MARKET_NAMES: Record<string, string> = { cn: '中文', en: '英文', jp: '日文', kr: '韩文' }
const TAG_NAMES: Record<string, string> = {
  pr_material: '宣发素材', feature_opportunity: '功能机会', negative_pr: '负面口碑需处理',
  kol_lead: 'KOL线索', competitor: '竞品提及',
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
}

// 互动数（素材导出用）
function engagement(m: Record<string, number> | null | undefined): number {
  if (!m) return 0
  return ['like_count', 'liked_count', 'digg_count', 'comment_count', 'repost_count', 'share_count']
    .reduce((s, k) => s + (Number(m[k]) || 0), 0)
}

Deno.serve(async (req) => {
  const { path, url } = fnPath(req, 'api-export')
  if (path !== '/export' || req.method !== 'GET') return err('未知路径', 404)

  try {
    // 下载链接无法带 Authorization 头，用 query token 鉴权
    const token = url.searchParams.get('token') || ''
    const session = await verifyJwt(token, JWT_SECRET)
    if (!session) return err('未登录或登录已过期', 401)

    const scope = url.searchParams.get('scope') || 'mine'
    const filters: Record<string, string> = { ai_status: 'neq.skipped' }

    if (scope === 'all') {
      if (session.role !== 'admin') return err('导出全部数据需要管理员权限', 403)
    } else if (scope === 'material') {
      // 宣发素材库：收藏的素材（本人收藏 + 管理员导出全部素材）
      if (session.role !== 'admin') filters['material_by'] = `eq.${session.sub}`
      filters['is_material'] = 'eq.true'
    } else {
      filters['claim_user_id'] = `eq.${session.sub}`
      filters['status'] = 'in.(claimed,replied)'
    }

    for (const k of ['platform', 'ai_scene', 'ai_priority', 'content_type', 'part_type', 'market']) {
      const v = url.searchParams.get(k)
      if (v) filters[k] = `eq.${v}`
    }

    // 时间范围
    const range = url.searchParams.get('range') || ''
    if (range === 'today') {
      filters['created_at'] = `gte.${new Date().toISOString().slice(0, 10)}`
    } else if (range === 'this_week') {
      filters['created_at'] = `gte.${new Date(Date.now() - 7 * 86400_000).toISOString()}`
    } else if (range === 'this_month') {
      const d = new Date(); d.setDate(1)
      filters['created_at'] = `gte.${d.toISOString()}`
    } else if (range === 'custom') {
      const start = url.searchParams.get('start') || ''
      const end = url.searchParams.get('end') || ''
      // PostgREST 同列多条件：and=(created_at.gte.X,created_at.lte.Y)
      const conds: string[] = []
      if (/^\d{4}-\d{2}-\d{2}$/.test(start)) conds.push(`created_at.gte.${start}`)
      if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        const endDate = new Date(end); endDate.setDate(endDate.getDate() + 1)
        conds.push(`created_at.lt.${endDate.toISOString()}`)
      }
      if (conds.length) filters['and'] = `(${conds.join(',')})`
    }

    const { data: items } = await restSelect<Record<string, unknown>>('feedback_items', {
      select: '*,claim_user:users!feedback_items_claim_user_id_fkey(name)', order: 'created_at.desc', limit: 5000, ...filters,
    })

    // ---------- 宣发素材 brief（scope=material）----------
    if (scope === 'material') {
      const headers = [
        '金句(用户原话)', '内容摘录', '原文链接', '点赞数', '评论数', '互动总数', '平台', '市场',
        '场景', '情感', '作者', '发布时间', '收藏时间', '回复链接', '回复后互动',
      ]
      const lines = [headers.map(csvCell).join(',')]
      for (const it of items || []) {
        const m = (it.metrics_json as Record<string, number>) || {}
        const after = (it.metrics_after_json as Record<string, number>) || null
        lines.push([
          it.ai_quote || (it.ai_sentiment === 'positive' ? String(it.content_text || '').slice(0, 60) : ''),
          String(it.content_text || '').slice(0, 150),
          it.source_url,
          m.like_count ?? m.liked_count ?? m.digg_count ?? '',
          m.comment_count ?? '',
          engagement(m),
          PLATFORM_NAMES[String(it.platform)] || it.platform,
          MARKET_NAMES[String(it.market || 'cn')] || '中文',
          SCENE_NAMES[String(it.ai_scene)] || '',
          SENT_NAMES[String(it.ai_sentiment)] || '',
          it.author_name || '',
          it.publish_time || '',
          String(it.material_at || '').slice(0, 19).replace('T', ' '),
          it.reply_url || '',
          after ? engagement(after) : '',
        ].map(csvCell).join(','))
      }
      const csv = '\uFEFF' + lines.join('\r\n')
      const date = new Date().toISOString().slice(0, 10)
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="pr_material_${date}.csv"`,
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // ---------- 常规导出 ----------
    const headers = [
      'ID', '来源', '平台', '市场', '类型', '场景', '优先级', '情感', '运营用途', '状态', '认领人',
      '作者', '发布时间', '反馈内容', '用户卡点原话', '置信度', '引句核验', '话题',
      '原文链接', '回复链接', '回复时间', '跳过理由', '回复后互动', 'AI分析理由', '命中关键词', '抓取时间',
    ]
    const lines = [headers.map(csvCell).join(',')]

    for (const it of items || []) {
      const tags = ((it.ai_tags_json as string[]) || []).map((t) => TAG_NAMES[t] || t).join(' / ')
      const matched = ((it.matched_keywords as string[]) || []).join(' / ')
      const after = (it.metrics_after_json as Record<string, number>) || null
      lines.push([
        it.id,
        PART_NAMES[String(it.part_type)] || it.part_type,
        PLATFORM_NAMES[String(it.platform)] || it.platform,
        MARKET_NAMES[String(it.market || 'cn')] || '中文',
        TYPE_NAMES[String(it.content_type)] || it.content_type,
        SCENE_NAMES[String(it.ai_scene)] || '',
        String(it.ai_priority || '').toUpperCase(),
        SENT_NAMES[String(it.ai_sentiment)] || '',
        tags,
        STATUS_NAMES[String(it.status)] || it.status,
        (it.claim_user as { name?: string } | null)?.name || '',
        it.author_name || '',
        it.publish_time || '',
        it.content_text,
        it.ai_quote || '',
        it.ai_confidence ?? '',
        it.ai_verified === null ? '' : it.ai_verified ? '已核验' : '未核验',
        it.ai_topic || '',
        it.source_url,
        it.reply_url || '',
        String(it.replied_at || '').slice(0, 19).replace('T', ' '),
        it.skip_reason || '',
        after ? engagement(after) : '',
        it.ai_reason || '',
        matched,
        String(it.created_at || '').slice(0, 19).replace('T', ' '),
      ].map(csvCell).join(','))
    }

    const csv = '\uFEFF' + lines.join('\r\n')
    const date = new Date().toISOString().slice(0, 10)
    const filename = `feedback_${scope}_${date}.csv`
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return err(e instanceof Error ? e.message : '导出失败', 500)
  }
})
