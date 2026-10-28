// 个人导出 API（CSV，带 BOM，Excel 可直接打开）
// GET /export?scope=mine|all&token=...&platform=&ai_scene=...（可选过滤）
import { err, fnPath } from '../_shared/cors.ts'
import { verifyJwt, type SessionPayload } from '../_shared/jwt.ts'
import { restSelect } from '../_shared/rest.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || ''

const PLATFORM_NAMES: Record<string, string> = {
  xhs: '小红书', wb: '微博', bili: 'B站', dy: '抖音', x: 'X',
}
const TYPE_NAMES: Record<string, string> = { video: '视频', note: '笔记', post: '帖子', comment: '评论' }
const PART_NAMES: Record<string, string> = { part_a: '沉浸式翻译相关', part_b: '全量场景' }
const SCENE_NAMES: Record<string, string> = { comic: '漫画', novel: '小说/AO3', video: '视频', other: '其他' }
const SENT_NAMES: Record<string, string> = { positive: '正面', neutral: '中性', negative: '负面' }
const STATUS_NAMES: Record<string, string> = { new: '待处理', claimed: '已认领', processed: '已处理', ignored: '已忽略' }
const TAG_NAMES: Record<string, string> = {
  pr_material: '宣发素材', feature_opportunity: '功能机会', negative_pr: '负面口碑需处理',
  kol_lead: 'KOL线索', competitor: '竞品提及',
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
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
    } else {
      filters['claim_user_id'] = `eq.${session.sub}`
      filters['status'] = 'in.(claimed,processed)'
    }
    for (const k of ['platform', 'ai_scene', 'ai_priority', 'content_type', 'part_type']) {
      const v = url.searchParams.get(k)
      if (v) filters[k] = `eq.${v}`
    }

    const { data: items } = await restSelect<Record<string, unknown>>('feedback_items', {
      select: '*,claim_user:users(name)', order: 'created_at.desc', limit: 5000, ...filters,
    })

    const headers = [
      'ID', '来源', '平台', '类型', '场景', '优先级', '情感', '运营用途', '状态', '认领人',
      '作者', '发布时间', '反馈内容', '原文链接', 'AI分析理由', '命中关键词', '抓取时间',
    ]
    const lines = [headers.map(csvCell).join(',')]

    for (const it of items || []) {
      const tags = ((it.ai_tags_json as string[]) || []).map((t) => TAG_NAMES[t] || t).join(' / ')
      const matched = ((it.matched_keywords as string[]) || []).join(' / ')
      lines.push([
        it.id,
        PART_NAMES[String(it.part_type)] || it.part_type,
        PLATFORM_NAMES[String(it.platform)] || it.platform,
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
        it.source_url,
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
