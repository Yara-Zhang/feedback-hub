// 抓取引擎：分片调度 worker
// POST /          —— 定时任务入口（Supabase cron 每 5 分钟调用，service key）
// POST /trigger   —— 管理员手动触发一轮 + 可设置每日预算
// GET  /status    —— 队列/用量/平台状态
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { requireUser, requireAdminOrService } from '../_shared/auth.ts'
import { restSelect, restPatch, restInsert, restRpc } from '../_shared/rest.ts'
import { adapters, fetchDetail, type NormalItem, type Platform } from '../_shared/tikhub/platforms.ts'
import { loadKeywords, prefilter, sha256Hex, detectLang, marketOf } from '../_shared/prefilter.ts'
import { verifyQuote } from '../_shared/quote-verify.ts'
import { chatJson } from '../_shared/llm.ts'

interface JobRow {
  id: number
  job_type: 'search' | 'fetch_comments' | 'enrich_llm' | 'recheck'
  platform: Platform | null
  keyword: string | null
  source_id: string | null
  source_url: string | null
  cursor_info: Record<string, unknown>
  status: string
  retry_count: number
  updated_at: string
}

// ---------- 配置读写 ----------
async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const { data } = await restSelect<{ value: T }>('app_config', { select: 'value', key: `eq.${key}` }, { single: true })
  return data?.[0]?.value ?? fallback
}

async function setConfig(key: string, value: unknown): Promise<void> {
  await restInsert('app_config', [{ key, value }], { onConflict: 'key' })
  await restPatch('app_config', { key: `eq.${key}` }, { value, updated_at: new Date().toISOString() })
}

// ---------- 用量与预算 ----------
async function usageToday(): Promise<{ tikhub: number; llm: number; paused: boolean }> {
  const { data } = await restSelect<{ tikhub_calls: number; llm_calls: number; budget_paused: boolean }>('api_usage', {
    select: 'tikhub_calls,llm_calls,budget_paused', day: `eq.${new Date().toISOString().slice(0, 10)}`,
  }, { single: true })
  return {
    tikhub: data?.[0]?.tikhub_calls ?? 0,
    llm: data?.[0]?.llm_calls ?? 0,
    paused: data?.[0]?.budget_paused ?? false,
  }
}

// ---------- 平台熔断 ----------
interface PauseEntry { platform: string; until: string }
async function pausedPlatforms(): Promise<Set<string>> {
  const list = await getConfig<PauseEntry[]>('paused_platforms', [])
  const now = Date.now()
  const active = (list || []).filter((p) => new Date(p.until).getTime() > now)
  if (active.length !== (list || []).length) {
    await setConfig('paused_platforms', active)
  }
  return new Set(active.map((p) => p.platform))
}

async function pausePlatform(platform: string): Promise<void> {
  const list = await getConfig<PauseEntry[]>('paused_platforms', [])
  const until = new Date(Date.now() + 2 * 3600_000).toISOString()
  await setConfig('paused_platforms', [...(list || []).filter((p) => p.platform !== platform), { platform, until }])
  // 飞书告警（尽力而为）
  try {
    await sendWebhookCard({
      header: { title: { tag: 'plain_text', content: '⚠️ 抓取平台熔断告警' } },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: `平台 **${platform}** 连续失败，已自动暂停 2 小时。请管理员到工作台「抓取状态」页查看。` } }],
    })
  } catch { /* webhook 未配置则忽略 */ }
}

async function countRecentFailures(platform: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const { count } = await restSelect('crawl_jobs', {
    select: 'id', status: 'eq.failed', platform: `eq.${platform}`, updated_at: `gte.${since}`, limit: 1,
  }, { count: true })
  return count
}

// ---------- 任务处理 ----------
async function finishJob(job: JobRow, note = ''): Promise<void> {
  await restPatch('crawl_jobs', { id: `eq.${job.id}` }, { status: 'done', result_note: note.slice(0, 500) })
}

async function failJob(job: JobRow, msg: string): Promise<void> {
  const retry = (job.retry_count ?? 0) + 1
  await restPatch('crawl_jobs', { id: `eq.${job.id}` }, {
    status: retry >= 3 ? 'failed' : 'pending',
    retry_count: retry,
    result_note: msg.slice(0, 500),
    locked_at: null,
  })
}

async function requeueJob(job: JobRow, note = ''): Promise<void> {
  await restPatch('crawl_jobs', { id: `eq.${job.id}` }, { status: 'pending', locked_at: null, result_note: note.slice(0, 500) })
}

// 入库（去重 + 预筛在调用方完成；market 市场标记）
async function insertItems(
  items: NormalItem[], platform: Platform, partType: 'part_a' | 'part_b', matched: string[],
  market: string = 'cn', parentInfo?: Record<string, unknown>,
): Promise<number> {
  const rows: Record<string, unknown>[] = []
  for (const it of items) {
    if (!it.text || it.text.length < 4) continue
    const dedup = await sha256Hex(`${platform}|${it.source_id}`)
    rows.push({
      part_type: partType,
      platform,
      content_type: it.content_type,
      source_id: it.source_id,
      source_url: it.source_url,
      author_name: it.author_name?.slice(0, 100) || null,
      author_id: it.author_id || null,
      content_text: it.text.slice(0, 3000),
      publish_time: it.publish_time || null,
      metrics_json: it.metrics,
      extra_json: { ...(it.extra || {}), ...(parentInfo || {}) },
      matched_keywords: matched.slice(0, 10),
      market,
      dedup_hash: dedup,
    })
  }
  if (!rows.length) return 0
  const inserted = await restInsert('feedback_items', rows, { onConflict: 'dedup_hash', ignoreDuplicates: true })
  return inserted.length
}

// 评论任务入队规则：Part A 全覆盖；Part B 高互动才抓评论
async function maybeEnqueueComments(job: JobRow, it: NormalItem, partType: string): Promise<void> {
  if (it.content_type === 'comment' || it.comment_count <= 0) return
  const threshold = partType === 'part_a' ? 0 : await getConfig<number>('comment_fetch_threshold', 30)
  if (it.comment_count < threshold) return
  await restInsert('crawl_jobs', [{
    job_type: 'fetch_comments',
    platform: job.platform,
    source_id: it.source_id,
    source_url: it.source_url,
    cursor_info: { page: 1, parent_summary: it.text.slice(0, 200), parent_author: it.author_name },
  }])
}

async function processSearch(job: JobRow, budget: number, used: number): Promise<void> {
  if (used >= budget) { await requeueJob(job, '预算暂停'); return }
  const adapter = adapters[job.platform as Platform]
  const page = Number(job.cursor_info?.page || 1)
  const keywords = await loadKeywords()
  let inserted = 0, relevant = 0

  // X 平台：日/韩市场关键词拼接 lang 操作符（关键词市场来自 keywords.market）
  let query = job.keyword || ''
  if (job.platform === 'x' && job.keyword) {
    const kwRow = keywords.find((k) => k.keyword === job.keyword)
    const kwMarket = kwRow?.market || 'cn'
    if (kwMarket === 'jp') query = `${query} lang:ja`
    else if (kwMarket === 'kr') query = `${query} lang:ko`
  }

  const results = await adapter.search(query, page)
  for (const it of results) {
    const pf = prefilter(it.text, keywords, job.platform as string)
    if (!pf.relevant) continue
    relevant++
    // 市场判定：关键词显式市场 > 内容语言（X 用接口返回 lang 优先） > 平台兜底
    const lang = job.platform === 'x' ? (String((it.extra as Record<string, unknown>)?.lang ?? '') || null) : null
    const market = marketOf(pf.kwMarket, lang || detectLang(it.text), job.platform as string)
    inserted += await insertItems([it], job.platform as Platform, pf.partType, pf.matched, market)
    await maybeEnqueueComments(job, it, pf.partType)
  }
  // 关键词命中数
  if (inserted > 0 && job.keyword) {
    await restRpc('inc_keyword_hits', { p_keyword: job.keyword, p_n: inserted }).catch(() => {})
  }
  // 结果满页则翻页（最多 2 页）
  if (results.length >= 10 && page < 2) {
    await restInsert('crawl_jobs', [{
      job_type: 'search', platform: job.platform, keyword: job.keyword,
      cursor_info: { page: page + 1 },
    }])
  }
  await finishJob(job, `命中${relevant}/返回${results.length}，入库${inserted}`)
}

async function processComments(job: JobRow, budget: number, used: number): Promise<void> {
  if (used >= budget) { await requeueJob(job, '预算暂停'); return }
  if (!job.source_id || !job.platform) { await finishJob(job, '无效任务'); return }
  const adapter = adapters[job.platform as Platform]
  const page = Number(job.cursor_info?.page || 1)
  const keywords = await loadKeywords()

  const comments = await adapter.fetchComments(job.source_id.split(':')[0], page)
  let inserted = 0
  for (const c of comments) {
    // 评论预筛放宽：无排除词 + 命中任一关键词
    const pf = prefilter(c.text, keywords, job.platform as string)
    if (!pf.relevant) continue
    const market = marketOf(pf.kwMarket, detectLang(c.text), job.platform as string)
    const parentInfo = {
      parent_summary: job.cursor_info?.parent_summary || '',
      parent_author: job.cursor_info?.parent_author || '',
    }
    inserted += await insertItems([c], job.platform as Platform, pf.partType, pf.matched, market, parentInfo)
  }
  // 翻页（每内容最多 3 页）
  if (comments.length >= 20 && page < 3) {
    await restInsert('crawl_jobs', [{
      job_type: 'fetch_comments', platform: job.platform, source_id: job.source_id, source_url: job.source_url,
      cursor_info: { ...job.cursor_info, page: page + 1 },
    }])
  }
  await finishJob(job, `评论入库${inserted}/${comments.length}`)
}

// ---------- LLM 精筛 ----------
interface LlmResult {
  id: number; relevant: boolean; scene: string; sentiment: string
  priority: string; tags: string[]; reason: string
  quote?: string | null; confidence?: number; topic?: string | null
}

// 互动总数（用于告警阈值判断）
function totalEngagement(metrics: Record<string, number> | null | undefined): number {
  if (!metrics) return 0
  const keys = ['like_count', 'liked_count', 'digg_count', 'comment_count', 'repost_count', 'share_count']
  return keys.reduce((s, k) => s + (Number(metrics[k]) || 0), 0)
}

async function processEnrich(job: JobRow): Promise<void> {
  const ids = (job.source_id || '').split(',').map(Number).filter(Boolean)
  if (!ids.length) { await finishJob(job, '空批次'); return }
  const { data: items } = await restSelect<{
    id: number; platform: string; content_type: string; content_text: string
    part_type: string; metrics_json: Record<string, number> | null; source_url: string
  }>('feedback_items', {
    select: 'id,platform,content_type,content_text,part_type,metrics_json,source_url', id: `in.(${ids.join(',')})`,
  })

  const input = items.map((i) => ({
    id: i.id, platform: i.platform, type: i.content_type, part: i.part_type,
    text: i.content_text.slice(0, 500),
  }))

  const system = `你是「沉浸式翻译」产品的用户反馈分析师。产品是一款浏览器/手机端网页翻译工具，即将发布手机 APP，主打三个内容消费场景：手机看漫画（漫画翻译）、看 AO3/小说（网页/电子书翻译）、看视频（双语字幕/实时翻译）。

对每条社媒反馈（帖子/笔记/视频/评论，可能来自中国、日本、韩国、英语市场，正文语言不限）输出判定，字段：
- relevant: 是否与「手机端漫画/小说(AO3)/视频翻译的用户体验、需求、吐槽、求助」或「沉浸式翻译产品本身」相关。以下一律判 false：
  ① 营销广告、招聘兼职、纯新闻搬运；
  ② 发布者是「提供」翻译而非「需要」翻译——字幕组/汉化组发布翻译成果（标题含"翻译：@某某""资源：@某某""中字""熟肉""汉化"等发布式表述，或本身就是作品搬运）；
  ③ 成人/NSFW 或政治敏感内容。
- scene: comic(漫画) / novel(小说、AO3、网文) / video(视频、直播、字幕) / other
- sentiment: positive / neutral / negative
- priority: p0(产品直接负面口碑或重大抱怨；明确的手机端场景功能需求/痛点；高互动的正面体验惊叹——可直接用作宣发素材) / p1(一般性需求、吐槽、求助、竞品对比) / p2(弱相关或泛泛而谈)
- tags: 数组，从固定集合选：pr_material(可作宣发素材) / feature_opportunity(功能机会) / negative_pr(负面口碑需处理) / kol_lead(疑似KOL/博主，可合作线索) / competitor(提及竞品)；可为空数组
- quote: relevant=true 时，从原帖逐字摘出一句（≤60 字）能直接看出「发帖人本人卡在外语/翻译上」的原话（如"看不懂英文""no english subtitles""한글 자막 없어서 못 봐"）；找不到这样的原话则置 null。relevant=false 置 null。
- confidence: 本次判定的置信度，0 到 1 的小数
- topic: relevant=true 时给出 2-8 个字的话题概括（如"漫画没汉化""AO3读不懂""没中文字幕"），同一话题的帖子用相同表述；relevant=false 置 null
- reason: 一句话中文说明判定理由

仅输出 JSON：{"results": [{...每条一个对象，包含全部字段}]}`

  try {
    const out = await chatJson<{ results: LlmResult[] }>([
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(input) },
    ], 3000)
    await restRpc('inc_usage', { p_llm: 1 }).catch(() => {})

    // 告警配置（低置信/未核验只标记不拦截）
    const alarmEnabled = await getConfig<boolean>('alarm_enabled', true)
    const alarmThreshold = await getConfig<number>('alarm_threshold', 50)

    for (const r of out.results || []) {
      const valid = (v: string, set: string[]) => set.includes(v) ? v : null
      const scene = valid(r.scene, ['comic', 'novel', 'video', 'other'])
      const sentiment = valid(r.sentiment, ['positive', 'neutral', 'negative'])
      const priority = r.relevant ? valid(r.priority, ['p0', 'p1', 'p2']) : null
      const tags = Array.isArray(r.tags) ? r.tags.filter((t) => ['pr_material', 'feature_opportunity', 'negative_pr', 'kol_lead', 'competitor'].includes(t)) : []
      const item = items.find((i) => i.id === r.id)

      // quote 核验：摘出的原句必须真实出现在原文里（防 LLM 幻觉摘句）
      const verified = verifyQuote(r.quote ?? null, item?.content_text ?? '')

      // 低置信/未核验前缀标记（不 skip，供运营直读）
      let reasonPrefix = ''
      const confidence = typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : null
      if (r.relevant && confidence != null && confidence < 0.7) reasonPrefix = '[低置信] '
      if (r.relevant && verified === false) reasonPrefix += '[引句未核验] '

      // P0 负面入每日告警汇总（不逐条实时推群；每日 10:00 alarm-digest 统一发飞书）
      const eng = item ? totalEngagement(item.metrics_json) : 0
      const needAlarm = !!(alarmEnabled && r.relevant && priority === 'p0' && sentiment === 'negative' && eng >= alarmThreshold)

      await restPatch('feedback_items', { id: `eq.${r.id}` }, {
        ai_priority: priority,
        ai_scene: r.relevant ? scene : 'other',
        ai_sentiment: r.relevant ? sentiment : null,
        ai_tags_json: r.relevant ? tags : [],
        ai_reason: (reasonPrefix + (r.reason || '')).slice(0, 500),
        ai_status: r.relevant ? 'done' : 'skipped',
        ai_quote: r.relevant ? (r.quote || '').slice(0, 120) || null : null,
        ai_confidence: r.relevant ? confidence : null,
        ai_verified: r.relevant ? verified : null,
        ai_topic: r.relevant ? (r.topic || '').slice(0, 40) || null : null,
        alarm_flag: needAlarm,
      })
    }
    await finishJob(job, `精筛${(out.results || []).length}条`)
  } catch (e) {
    await failJob(job, e instanceof Error ? e.message : 'LLM 精筛失败')
  }
}

// ---------- 回复效果复查（recheck） ----------
async function processRecheck(job: JobRow): Promise<void> {
  const itemId = Number(job.cursor_info?.item_id)
  const tikhubId = String(job.source_id || '')
  const extra = (job.cursor_info?.extra as Record<string, unknown>) || {}
  if (!itemId || !job.platform || !tikhubId) { await finishJob(job, '无效任务'); return }

  const metrics = await fetchDetail(job.platform as Platform, tikhubId, job.source_url || '', extra)
  if (metrics && Object.keys(metrics).length) {
    await restPatch('feedback_items', { id: `eq.${itemId}` }, {
      metrics_after_json: metrics,
      recheck_at: new Date().toISOString(),
    })
    await finishJob(job, `复查成功：${JSON.stringify(metrics)}`)
  } else {
    await restPatch('feedback_items', { id: `eq.${itemId}` }, { recheck_at: new Date().toISOString() })
    await finishJob(job, '该平台详情不可用（如抖音）或获取失败，互动数未更新')
  }
}

// ---------- 主循环 ----------
async function runTick(): Promise<{ processed: number; note: string }> {
  // 补充新一轮任务（enqueue_round 内部有 6h 去重 + 预算熔断）
  await restRpc('enqueue_round').catch(() => {})
  await restRpc('enqueue_llm_jobs').catch(() => {})

  const jobs = await restRpc<JobRow[]>('pop_jobs', { p_limit: 2 })
  if (!Array.isArray(jobs) || !jobs.length) return { processed: 0, note: '队列为空' }

  const budget = await getConfig<number>('daily_budget', 1500)
  const paused = await pausedPlatforms()
  const start = Date.now()
  let processed = 0

  for (const job of jobs) {
    if (Date.now() - start > 40_000) { await requeueJob(job, '时间片用尽'); continue }
    // 平台熔断跳过（详情复查 recheck 不受搜索熔断影响）
    if (job.platform && paused.has(job.platform) && (job.job_type === 'search' || job.job_type === 'fetch_comments')) {
      await requeueJob(job, '平台熔断暂停中')
      continue
    }
    try {
      if (job.job_type === 'search') {
        await processSearch(job, budget, (await usageToday()).tikhub)
      } else if (job.job_type === 'fetch_comments') {
        await processComments(job, budget, (await usageToday()).tikhub)
      } else if (job.job_type === 'enrich_llm') {
        await processEnrich(job)
      } else if (job.job_type === 'recheck') {
        await processRecheck(job)
      }
      processed++
      // 平台连续失败熔断检测（仅搜索/评论类任务）
      if (job.platform && (job.job_type === 'search' || job.job_type === 'fetch_comments')) {
        const fails = await countRecentFailures(job.platform)
        if (fails >= 5 && !paused.has(job.platform)) await pausePlatform(job.platform)
      }
    } catch (e) {
      await failJob(job, e instanceof Error ? e.message : '未知错误')
    }
  }
  return { processed, note: `处理 ${processed}/${jobs.length} 个任务` }
}

// ---------- 路由 ----------
Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path } = fnPath(req, 'crawl-tick')

  try {
    // 定时入口（service key）
    if ((path === '' || path === '/') && req.method === 'POST') {
      await requireAdminOrService(req)
      const r = await runTick()
      return json(r)
    }

    // 手动触发
    if (path === '/trigger' && req.method === 'POST') {
      const session = await requireAdminOrService(req)
      if (!('service' in session)) {
        const b = await body<{ set_daily_budget?: number }>(req)
        if (b.set_daily_budget && b.set_daily_budget >= 100) {
          await setConfig('daily_budget', Math.floor(b.set_daily_budget))
        }
      }
      const r = await runTick()
      return json({ ok: true, ...r })
    }

    // 状态
    if (path === '/status' && req.method === 'GET') {
      await requireUser(req)
      const usage = await usageToday()
      const budget = await getConfig<number>('daily_budget', 1500)
      const today = new Date().toISOString().slice(0, 10)
      const [pending, todayItems, recent, lastRound] = await Promise.all([
        restSelect('crawl_jobs', { select: 'id', status: 'eq.pending', limit: 1 }, { count: true }),
        restSelect('feedback_items', { select: 'id', created_at: `gte.${today}`, limit: 1 }, { count: true }),
        restSelect<JobRow>('crawl_jobs', { select: '*', order: 'updated_at.desc', limit: 15 }),
        getConfig<string | null>('last_round_at', null),
      ])
      const paused = await pausedPlatforms()
      return json({
        today_usage: usage.tikhub,
        today_llm: usage.llm,
        budget_paused: usage.paused || usage.tikhub >= budget,
        daily_budget: typeof budget === 'string' ? Number(budget) : budget,
        pending_jobs: pending.count,
        today_items: todayItems.count,
        recent_jobs: recent.data,
        last_round: lastRound ? String(lastRound).slice(0, 19).replace('T', ' ') : null,
        paused_platforms: [...paused],
      })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '鉴权失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '内部错误', 500)
  }
})
