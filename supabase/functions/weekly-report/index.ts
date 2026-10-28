// 飞书周报：每周一 09:30 北京时间（UTC cron 30 1 * * 1）由 Supabase 定时任务调用
// POST /          —— 生成并发送（service key 或管理员）
// GET  /preview   —— 预览（管理员，不发送）
import { preflight, json, err, fnPath } from '../_shared/cors.ts'
import { requireAdminOrService } from '../_shared/auth.ts'
import { restSelect, restInsert, restPatch } from '../_shared/rest.ts'
import { sendWebhookCard } from '../_shared/feishu.ts'

const PLATFORM_NAMES: Record<string, string> = {
  xhs: '小红书', wb: '微博', bili: 'B站', dy: '抖音', x: 'X',
}
const SCENE_NAMES: Record<string, string> = { comic: '漫画', novel: '小说/AO3', video: '视频', other: '其他' }

interface ItemRow {
  id: number; platform: string; content_text: string; source_url: string
  ai_priority: string | null; ai_sentiment: string | null; ai_tags_json: string[]
  author_name: string | null; part_type: string; content_type: string
}

async function buildReport(): Promise<{ stats: Record<string, unknown>; card: Record<string, unknown> }> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()

  const [total, byPlatform, p0p1, negative, prMaterial, kolLeads] = await Promise.all([
    restSelect('feedback_items', {
      select: 'id', ai_status: 'neq.skipped', created_at: `gte.${since}`, limit: 1,
    }, { count: true }),
    restSelect<{ platform: string }>('feedback_items', {
      select: 'platform', ai_status: 'neq.skipped', created_at: `gte.${since}`, limit: 5000,
    }),
    restSelect<ItemRow>('feedback_items', {
      select: 'id,platform,content_text,source_url,ai_priority,author_name',
      ai_status: 'neq.skipped', status: 'in.(new,claimed)',
      ai_priority: 'in.(p0,p1)', order: 'ai_priority.asc,created_at.desc', limit: 10,
    }),
    restSelect<ItemRow>('feedback_items', {
      select: 'id,platform,content_text,source_url,ai_sentiment,author_name',
      ai_status: 'neq.skipped', ai_sentiment: 'eq.negative', status: 'in.(new,claimed)',
      order: 'created_at.desc', limit: 5,
    }),
    restSelect('feedback_items', {
      select: 'id', ai_tags_json: 'cs.["pr_material"]', status: 'eq.new', ai_status: 'neq.skipped',
      created_at: `gte.${since}`, limit: 1,
    }, { count: true }),
    restSelect('feedback_items', {
      select: 'id', ai_tags_json: 'cs.["kol_lead"]', ai_status: 'neq.skipped',
      created_at: `gte.${since}`, limit: 1,
    }, { count: true }),
  ])

  const platformCounts: Record<string, number> = {}
  for (const r of byPlatform.data) platformCounts[r.platform] = (platformCounts[r.platform] || 0) + 1

  const range = `${new Date(Date.now() - 7 * 86400_000).toISOString().slice(5, 10).replace('-', '.')} - ${new Date().toISOString().slice(5, 10).replace('-', '.')}`

  const topMd = (p0p1.data || []).slice(0, 8).map((it, i) => {
    const text = it.content_text.slice(0, 40).replace(/[\n\r]/g, ' ')
    return `${i + 1}. [${PLATFORM_NAMES[it.platform] || it.platform}] ${text}… [查看原文](${it.source_url})`
  }).join('\n') || '本周暂无 P0/P1 待处理反馈 🎉'

  const negMd = (negative.data || []).map((it) => {
    const text = it.content_text.slice(0, 30).replace(/[\n\r]/g, ' ')
    return `- [${PLATFORM_NAMES[it.platform] || it.platform}] ${text}… [查看](${it.source_url})`
  }).join('\n') || '本周无未处理负面反馈 👍'

  const platformMd = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${PLATFORM_NAMES[p] || p} ${c}`).join(' · ') || '无新增'

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `📋 翻译场景用户反馈周报（${range}）` },
      template: 'turquoise',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**本周新增 ${total.count} 条有效反馈** ｜ P0/P1 待处理 **${(p0p1.data || []).length}+** ｜ 负面待处理 **${(negative.data || []).length}+** ｜ 宣发素材候选 **${prMaterial.count}** ｜ KOL线索 **${kolLeads.count}**` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**平台分布：**${platformMd}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**🔴 P0/P1 重点反馈（点击直达原文）**\n${topMd}` } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**⚠️ 未处理负面口碑**\n${negMd}` } },
      { tag: 'hr' },
      { tag: 'action', actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '💻 打开反馈工作台' }, type: 'primary', url: Deno.env.get('FRONTEND_URL') || '' },
      ] },
      { tag: 'note', elements: [{ tag: 'plain_text', content: '反馈工作台自动发送 · 内部调研资料，请勿外传' }] },
    ],
  }

  return {
    stats: {
      week_total: total.count,
      by_platform: platformCounts,
      p0p1_list: p0p1.data,
      negative_list: negative.data,
      pr_material: prMaterial.count,
      kol_leads: kolLeads.count,
    },
    card,
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path } = fnPath(req, 'weekly-report')

  try {
    if (path === '/preview' && req.method === 'GET') {
      await requireAdminOrService(req)
      const { stats, card } = await buildReport()
      return json({ stats, card })
    }

    if ((path === '' || path === '/') && req.method === 'POST') {
      await requireAdminOrService(req)
      const { stats, card } = await buildReport()

      // 记录周报（本周一为 week_start）
      const now = new Date()
      const day = (now.getUTCDay() + 6) % 7 // 周一=0
      const monday = new Date(now.getTime() - day * 86400_000).toISOString().slice(0, 10)
      await restInsert('weekly_reports', [{ week_start: monday, stats_json: stats }], { onConflict: 'week_start' })
      await restPatch('weekly_reports', { week_start: `eq.${monday}` }, { stats_json: stats, sent_at: now.toISOString() })

      // 发送飞书群卡片
      await sendWebhookCard(card)
      return json({ ok: true, week_start: monday, stats })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '鉴权失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '周报发送失败', 500)
  }
})
