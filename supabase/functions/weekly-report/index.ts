// 飞书周报：每周一 09:30 北京时间（UTC cron 30 1 * * 1）由 Supabase 定时任务调用
// POST /              —— 生成并发送（service key 或管理员，body 可选 {period: 'daily'} 发昨日日报）
// GET  /preview       —— 预览（管理员，不发送，query ?period=daily 预览日报）
// POST /alarm-digest  —— 每日 P0 负面告警汇总（定时 UTC 02:00 或手动触发；发完清 alarm_flag 防重复）
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { requireAdminOrService } from '../_shared/auth.ts'
import { restSelect, restInsert, restPatch } from '../_shared/rest.ts'
import { sendWebhookCard } from '../_shared/feishu.ts'

const PLATFORM_NAMES: Record<string, string> = {
  xhs: '小红书', wb: '微博', bili: 'B站', dy: '抖音', x: 'X', reddit: 'Reddit', zhihu: '知乎',
}
const MARKET_NAMES: Record<string, string> = { cn: '中文', en: '英文', jp: '日文', kr: '韩文' }
const SCENE_NAMES: Record<string, string> = { comic: '漫画', novel: '小说/AO3', video: '视频', other: '其他' }

interface ItemRow {
  id: number; platform: string; content_text: string; source_url: string
  ai_priority: string | null; ai_sentiment: string | null; ai_tags_json: string[]
  author_name: string | null; part_type: string; content_type: string
}

// 昨日（北京时间）范围
function yesterdayRange(): { since: string; until: string; label: string } {
  const bjNow = Date.now() + 8 * 3600_000
  const todayStart = new Date(bjNow); todayStart.setUTCHours(0, 0, 0, 0)
  const yStart = new Date(todayStart.getTime() - 86400_000)
  return {
    since: yStart.toISOString(),
    until: todayStart.toISOString(),
    label: `${yStart.getUTCMonth() + 1}.${yStart.getUTCDate()}`,
  }
}

async function buildReport(period: 'weekly' | 'daily' = 'weekly'): Promise<{ stats: Record<string, unknown>; card: Record<string, unknown> }> {
  // 时间窗：weekly 近 7 天；daily 昨日（北京时间）
  let since: string, until: string | null = null, rangeLabel: string
  if (period === 'daily') {
    const y = yesterdayRange()
    since = y.since; until = y.until; rangeLabel = `昨日（${y.label}）`
  } else {
    since = new Date(Date.now() - 7 * 86400_000).toISOString()
    rangeLabel = `${new Date(Date.now() - 7 * 86400_000).toISOString().slice(5, 10).replace('-', '.')} - ${new Date().toISOString().slice(5, 10).replace('-', '.')}`
  }
  // 时间窗过滤（daily 用 and 双边界）
  const timeFilter: Record<string, string> = until
    ? { and: `(created_at.gte.${since},created_at.lt.${until})` }
    : { created_at: `gte.${since}` }

  const [total, byPlatform, byMarket, p0p1, negative, prMaterial, kolLeads] = await Promise.all([
    restSelect('feedback_items', {
      select: 'id', ai_status: 'neq.skipped', ...timeFilter, limit: 1,
    }, { count: true }),
    restSelect<{ platform: string }>('feedback_items', {
      select: 'platform', ai_status: 'neq.skipped', ...timeFilter, limit: 5000,
    }),
    restSelect<{ market: string }>('feedback_items', {
      select: 'market', ai_status: 'neq.skipped', ...timeFilter, limit: 5000,
    }),
    restSelect<ItemRow>('feedback_items', {
      select: 'id,platform,content_text,source_url,ai_priority,author_name',
      ai_status: 'neq.skipped', status: 'in.(new,claimed)',
      ai_priority: 'in.(p0,p1)', order: 'ai_priority.asc,created_at.desc', limit: period === 'daily' ? 5 : 10,
    }),
    restSelect<ItemRow>('feedback_items', {
      select: 'id,platform,content_text,source_url,ai_sentiment,author_name',
      ai_status: 'neq.skipped', ai_sentiment: 'eq.negative', status: 'in.(new,claimed)',
      order: 'created_at.desc', limit: 5,
    }),
    restSelect('feedback_items', {
      select: 'id', ai_tags_json: 'cs.["pr_material"]', status: 'eq.new', ai_status: 'neq.skipped',
      ...timeFilter, limit: 1,
    }, { count: true }),
    restSelect('feedback_items', {
      select: 'id', ai_tags_json: 'cs.["kol_lead"]', ai_status: 'neq.skipped',
      ...timeFilter, limit: 1,
    }, { count: true }),
  ])

  const platformCounts: Record<string, number> = {}
  for (const r of byPlatform.data) platformCounts[r.platform] = (platformCounts[r.platform] || 0) + 1
  const marketCounts: Record<string, number> = {}
  for (const r of byMarket.data) {
    const m = r.market || 'cn'
    marketCounts[m] = (marketCounts[m] || 0) + 1
  }

  const topMd = (p0p1.data || []).slice(0, period === 'daily' ? 5 : 8).map((it, i) => {
    const text = it.content_text.slice(0, 40).replace(/[\n\r]/g, ' ')
    return `${i + 1}. [${PLATFORM_NAMES[it.platform] || it.platform}] ${text}… [查看原文](${it.source_url})`
  }).join('\n') || '本期暂无 P0/P1 待处理反馈 🎉'

  const negMd = (negative.data || []).map((it) => {
    const text = it.content_text.slice(0, 30).replace(/[\n\r]/g, ' ')
    return `- [${PLATFORM_NAMES[it.platform] || it.platform}] ${text}… [查看](${it.source_url})`
  }).join('\n') || '本期无未处理负面反馈 👍'

  const platformMd = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([p, c]) => `${PLATFORM_NAMES[p] || p} ${c}`).join(' · ') || '无新增'

  const marketMd = Object.entries(marketCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([m, c]) => `${MARKET_NAMES[m] || m} ${c}`).join(' · ') || '无新增'

  const title = period === 'daily'
    ? `📊 翻译场景用户反馈日报（${rangeLabel}）`
    : `📋 翻译场景用户反馈周报（${rangeLabel}）`

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: period === 'daily' ? 'blue' : 'turquoise',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**本期新增 ${total.count} 条有效反馈** ｜ P0/P1 待处理 **${(p0p1.data || []).length}+** ｜ 负面待处理 **${(negative.data || []).length}+** ｜ 宣发素材候选 **${prMaterial.count}** ｜ KOL线索 **${kolLeads.count}**` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**平台分布：**${platformMd}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**市场分布：**${marketMd}` } },
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
      period,
      week_total: total.count,
      by_platform: platformCounts,
      by_market: marketCounts,
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
  const { path, url } = fnPath(req, 'weekly-report')

  try {
    // ---------- 每日 P0 负面告警汇总 ----------
    if (path === '/alarm-digest' && req.method === 'POST') {
      await requireAdminOrService(req)
      const { data: rows } = await restSelect<{
        id: number; platform: string; content_text: string; source_url: string
        metrics_json: Record<string, number> | null; ai_quote: string | null
      }>('feedback_items', {
        select: 'id,platform,content_text,source_url,metrics_json,ai_quote',
        alarm_flag: 'eq.true', ai_priority: 'eq.p0', ai_sentiment: 'eq.negative', ai_status: 'neq.skipped',
        order: 'id.desc', limit: 20,
      })
      const alarms = rows || []
      if (!alarms.length) return json({ ok: true, sent: 0, note: '无待告警的 P0 负面反馈' })

      const eng = (m: Record<string, number> | null) => !m ? 0
        : ['like_count', 'liked_count', 'digg_count', 'comment_count', 'repost_count', 'share_count'].reduce((s, k) => s + (Number(m[k]) || 0), 0)
      const listMd = alarms.map((it, i) =>
        `${i + 1}. [${PLATFORM_NAMES[it.platform] || it.platform}] 互动 ${eng(it.metrics_json)}：${String(it.content_text).slice(0, 60).replace(/[\n\r]/g, ' ')}… [查看原帖](${it.source_url})`
      ).join('\n')

      await sendWebhookCard({
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: `🚨 P0 负面反馈汇总（${alarms.length} 条待处理）` }, template: 'red' },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: `**今日命中 ${alarms.length} 条高互动 P0 负面反馈，请优先处理：**\n${listMd}` } },
          { tag: 'hr' },
          { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '💻 打开反馈工作台' }, type: 'primary', url: Deno.env.get('FRONTEND_URL') || '' }] },
          { tag: 'note', elements: [{ tag: 'plain_text', content: '每日 10:00 自动发送 · 内部调研资料，请勿外传' }] },
        ],
      })
      // 发送成功后清零（全部待告警条目，含超出卡片展示的部分），防止重复推送
      await restPatch('feedback_items', { alarm_flag: 'eq.true' }, { alarm_flag: false })
      return json({ ok: true, sent: alarms.length })
    }

    if (path === '/preview' && req.method === 'GET') {
      await requireAdminOrService(req)
      const period = url.searchParams.get('period') === 'daily' ? 'daily' : 'weekly'
      const { stats, card } = await buildReport(period)
      return json({ stats, card })
    }

    if ((path === '' || path === '/') && req.method === 'POST') {
      const session = await requireAdminOrService(req)
      // 按需日报：body {period: 'daily'}（管理员手动触发；cron 服务调用无 body 默认周报）
      let period: 'weekly' | 'daily' = 'weekly'
      if (!('service' in session)) {
        try {
          const b = await body<{ period?: string }>(req)
          if (b.period === 'daily') period = 'daily'
        } catch { /* 无 body 默认 weekly */ }
      }
      const { stats, card } = await buildReport(period)

      if (period === 'weekly') {
        // 周报落库（本周一为 week_start）；日报不落库避免与周报同日冲突
        const now = new Date()
        const day = (now.getUTCDay() + 6) % 7 // 周一=0
        const monday = new Date(now.getTime() - day * 86400_000).toISOString().slice(0, 10)
        await restInsert('weekly_reports', [{ week_start: monday, stats_json: stats }], { onConflict: 'week_start' })
        await restPatch('weekly_reports', { week_start: `eq.${monday}` }, { stats_json: stats, sent_at: now.toISOString() })
        await sendWebhookCard(card)
        return json({ ok: true, week_start: monday, stats })
      }

      // 日报：直接发送
      await sendWebhookCard(card)
      return json({ ok: true, period: 'daily', stats })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '鉴权失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '周报发送失败', 500)
  }
})
