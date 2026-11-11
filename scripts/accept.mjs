#!/usr/bin/env node
// 端到端验收脚本（任务 #29）：本地签 admin JWT，经 pg_net 调用各 Edge Function API
// 用法: node scripts/accept.mjs [phase]   phase = all(默认) | api | verify | clean
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const line of readFileSync(join(ROOT, 'scripts/.deploy.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const REF = env.SUPA_PROJECT_REF, TOK = env.SUPA_ACCESS_TOKEN, JWT_SECRET = env.JWT_SECRET, CRON_SECRET = env.CRON_SECRET
const FN_BASE = `https://${REF}.supabase.co/functions/v1`

// ---------- 工具 ----------
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SQL 失败 ${res.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return text }
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`

// 经 pg_net 调函数（GET/POST），轮询 net._http_response 取结果
async function callFn(method, path, bodyObj, useJwt = true) {
  const token = useJwt ? JWT : CRON_SECRET
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const url = `${FN_BASE}${path}`
  const isGet = method === 'GET'
  const sql = isGet
    ? `select net.http_get(url := ${sqlStr(url)}, headers := ${sqlStr(JSON.stringify(headers))}::jsonb, timeout_milliseconds := 180000) as id;`
    : `select net.http_post(url := ${sqlStr(url)}, headers := ${sqlStr(JSON.stringify(headers))}::jsonb, body := ${sqlStr(JSON.stringify(bodyObj || {}))}::jsonb, timeout_milliseconds := 180000) as id;`
  const r = await q(sql)
  const id = Array.isArray(r) && r[0]?.id
  if (!id) throw new Error(`pg_net 发起失败: ${JSON.stringify(r).slice(0, 200)}`)
  // 轮询结果（最长 ~150s，慢端点如 crawl-tick / export 需要时间）
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 2500))
    const c = await q(`select status_code, content, error_msg from net._http_response where id = ${id};`)
    if (Array.isArray(c) && c.length) return { status: c[0].status_code, body: c[0].content, err: c[0].error_msg }
  }
  throw new Error(`pg_net 响应超时（${method} ${path}）`)
}

// ---------- JWT（张小雨 admin）----------
const JWT = signJwt({ sub: 1, open_id: 'accept-test', name: '张小雨', role: 'admin', exp: Math.floor(Date.now() / 1000) + 4 * 3600 })

const results = []
function report(name, pass, detail) {
  results.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`)
}

// ---------- Phase 1: 准备测试数据 ----------
async function prep() {
  console.log('\n===== Phase 1 准备测试数据 =====')
  // 7451: 求助帖（带完整打标字段，复刻上轮真实 enrich 结果）
  // 7454: jp 市场条目（generate 拦截测试）
  // 7455: P0 负面 + 高互动（告警链路测试），ai_status=pending 走真实 enrich
  await q(`insert into feedback_items
    (id, part_type, platform, content_type, source_id, source_url, author_name, content_text, metrics_json, market, ai_status,
     ai_priority, ai_sentiment, ai_scene, ai_quote, ai_confidence, ai_verified, ai_topic, dedup_hash, created_at)
   overriding system value values
    (7451, 'part_a', 'xhs', 'note', 't1', 'https://www.xiaohongshu.com/explore/t1', '求助网友',
     '看不懂日文漫画真的太痛苦了，追更三年一直等汉化组，现在等不起了，有没有好用的漫画翻译APP推荐啊，跪求',
     '{"liked_count":35,"comment_count":6}', 'cn', 'done', 'p0', 'negative', 'comic',
     '看不懂日文漫画真的太痛苦了', 0.95, true, '漫画没汉化', 'accept_t1', now()),
    (7454, 'part_a', 'x', 'post', 't4', 'https://x.com/t4', 'jp_user', '漫画 翻訳 アプリ おすすめありますか', '{"liked_count":12,"comment_count":3}', 'jp', 'done', null, null, null, null, null, null, null, 'accept_t4', now()),
    (7455, 'part_a', 'xhs', 'note', 't5', 'https://www.xiaohongshu.com/explore/t5', 'angry_user',
     '沉浸式翻译最近用不了了！漫画翻译出来全是乱码，翻译质量越来越差，付费会员有问题找客服也没人理，气死了，大家千万别买',
     '{"liked_count":45,"comment_count":8}', 'cn', 'pending', null, null, null, null, null, null, null, 'accept_t5', now())
   on conflict (id) do nothing;`)
  console.log('已插入 7451（带打标字段的求助帖）/ 7454（jp 拦截测试）/ 7455（P0 告警测试， pending 待 enrich）')
}

// ---------- Phase 2: API 端点验收 ----------
async function apiPhase() {
  console.log('\n===== Phase 2 API 端点验收 =====')

  // 2.0 热点分组
  const hot = await callFn('GET', '/api-items/hot')
  const hotJson = JSON.parse(hot.body || '{}')
  const hasTopic = (hotJson.groups || []).some((g) => g.topic === '漫画没汉化')
  report('GET /api-items/hot 话题分组', hot.status === 200 && hasTopic,
    `status=${hot.status} groups=${(hotJson.groups || []).map((g) => `${g.topic}(${g.count})`).join('、') || '无'} total=${hotJson.total}`)

  // 2.1 素材收藏
  const mat1 = await callFn('POST', '/api-items/7451/material')
  report('POST /:id/material 收藏', mat1.status === 200 && JSON.parse(mat1.body).is_material === true, mat1.body.slice(0, 80))

  // 2.2 认领 → 已回复（4 态流转）
  const claim = await callFn('POST', '/api-items/7451/claim')
  report('POST /:id/claim 认领', claim.status === 200, claim.body.slice(0, 80))
  const replied = await callFn('POST', '/api-items/7451/status', { status: 'replied', reply_url: 'https://www.xiaohongshu.com/comment/fake_reply_1' })
  report('POST /:id/status → replied', replied.status === 200, replied.body.slice(0, 80))

  // 2.3 jp/kr generate 拦截（7454 market=jp）
  const jpGen = await callFn('POST', '/api-reply/7454/generate', { draft_type: 'official' })
  report('POST /api-reply jp 监测期拦截', jpGen.status === 400 && /监测期/.test(jpGen.body), `status=${jpGen.status} ${jpGen.body.slice(0, 80)}`)

  // 2.4 recheck 入队
  const rc = await callFn('POST', '/api-items/recheck')
  report('POST /recheck 入队', rc.status === 200 && JSON.parse(rc.body).queued >= 1, rc.body.slice(0, 80))

  // 2.5 触发 crawl-tick 消化 enrich(7455) + recheck(7451)
  //    pop_jobs 已修优先级（enrich > recheck > search），少量 tick 即可出队
  console.log('  触发 crawl-tick（消化 enrich 告警测试 + recheck）…')
  let tickNote = ''
  for (let i = 0; i < 8; i++) {
    const t = await callFn('POST', '/crawl-tick', {})
    tickNote = (t.body || t.err || '').slice(0, 120)
    console.log(`  tick#${i + 1}: status=${t.status} ${tickNote}`)
    const st = await q(`select ai_status, ai_priority, ai_sentiment from feedback_items where id = 7455`)
    const rk = await q(`select status, result_note from crawl_jobs where job_type = 'recheck' and source_id = 't1' order by id desc limit 1`)
    const done7455 = Array.isArray(st) && st[0]?.ai_status === 'done'
    const rkDone = Array.isArray(rk) && rk[0] && rk[0].status !== 'pending'
    if (done7455 && rkDone) break
    if (!done7455 || !rkDone) await new Promise((r) => setTimeout(r, 3000))
  }

  // 恢复暂存任务（deferred → pending）—— 若有遗留
  await q(`update crawl_jobs set status = 'pending' where status = 'deferred'`)

  // 2.6 导出：素材 brief
  const expMat = await callFn('GET', `/api-export/export?scope=material&token=${JWT}`)
  const matCsvLines = (expMat.body || '').split('\r\n').filter(Boolean)
  const matHasQuote = /看不懂日文漫画|太痛苦/.test(expMat.body || '')
  report('GET /export scope=material 宣发 brief', expMat.status === 200 && matCsvLines.length >= 2, `行数=${matCsvLines.length} 含金句=${matHasQuote} 首行=${(matCsvLines[0] || '').slice(0, 60)}`)

  // 2.7 导出：mine + this_week
  const expMine = await callFn('GET', `/api-export/export?scope=mine&range=this_week&token=${JWT}`)
  const mineHas7451 = (expMine.body || '').includes('fake_reply_1')
  report('GET /export scope=mine&range=this_week', expMine.status === 200 && mineHas7451, `含已回复链接=${mineHas7451}`)

  // 2.8 日报 preview（不发送）
  const prev = await callFn('GET', '/weekly-report/preview?period=daily')
  const prevJson = JSON.parse(prev.body || '{}')
  report('GET /weekly-report/preview?period=daily', prev.status === 200 && prevJson.stats?.period === 'daily',
    `status=${prev.status} week_total=${prevJson.stats?.week_total} by_market=${JSON.stringify(prevJson.stats?.by_market)}`)

  // 2.9 关键词质量统计
  const kw = await callFn('GET', '/api-keywords/list')
  const kwJson = JSON.parse(kw.body || '{}')
  const anyStats = (kwJson.keywords || []).some((k) => k.stats && k.stats.hits > 0)
  report('GET /api-keywords/list 附质量统计', kw.status === 200 && anyStats, `status=${kw.status} 有关键词带统计=${anyStats} 示例=${JSON.stringify((kwJson.keywords || []).find((k) => k.stats && k.stats.hits > 0)?.stats || {})}`)

  // 2.10 真发日报到飞书（period=daily）
  const daily = await callFn('POST', '/weekly-report', { period: 'daily' })
  report('POST /weekly-report period=daily 发送', daily.status === 200 && JSON.parse(daily.body).ok === true, daily.body.slice(0, 120))
}

// ---------- Phase 3: 库内状态核验 ----------
async function verifyPhase() {
  console.log('\n===== Phase 3 库内状态核验 =====')
  const it = await q(`select id, status, claim_user_id, reply_url, replied_at, is_material, material_by,
    ai_quote, ai_verified, ai_confidence, ai_topic, market,
    ai_status, ai_priority, ai_sentiment from feedback_items where id in (7451, 7455) order by id`)
  const a = it[0] || {}, b = it[1] || {}
  report('7451 状态闭环', a.status === 'replied' && a.claim_user_id === 1 && !!a.reply_url && a.is_material === true && a.material_by === 1,
    `status=${a.status} claim=${a.claim_user_id} reply_url=${(a.reply_url || '').slice(0, 40)} material=${a.is_material}`)
  report('7455 P0 负面打标+告警', b.ai_status === 'done' && b.ai_priority === 'p0' && b.ai_sentiment === 'negative',
    `ai_status=${b.ai_status} priority=${b.ai_priority} sentiment=${b.ai_sentiment} verified=${b.ai_verified} quote=${(b.ai_quote || '').slice(0, 30)}`)
  const rk = await q(`select status, result_note, cursor_info->>'item_id' as item_id from crawl_jobs where job_type='recheck' and source_id='t1' order by id desc limit 1`)
  report('recheck 任务已处理', Array.isArray(rk) && rk[0] && ['done', 'failed'].includes(rk[0].status), `status=${rk[0]?.status} note=${(rk[0]?.result_note || '').slice(0, 60)}（t1 为假 source_id，预期"详情不可用"）`)
  const ksRaw = await q(`select keyword_stats()::text as s`)
  const ks = Array.isArray(ksRaw) ? JSON.parse(ksRaw[0].s) : []
  const ksTop = (ks || []).slice().sort((a, b) => b.hits - a.hits).slice(0, 3)
  report('keyword_stats() RPC', Array.isArray(ks) && ks.length >= 1, `top3=${JSON.stringify(ksTop)}`)
  // 回复后互动字段
  const after = await q(`select recheck_at, metrics_after_json from feedback_items where id = 7451`)
  report('7451 recheck_at 已写', !!after[0]?.recheck_at, `recheck_at=${after[0]?.recheck_at} after_json=${JSON.stringify(after[0]?.metrics_after_json)}`)
}

// ---------- Phase 4: 清理测试数据 ----------
async function cleanPhase() {
  console.log('\n===== Phase 4 清理测试数据 =====')
  await q(`delete from reply_drafts where item_id in (7451,7452,7453,7454,7455);
    delete from crawl_jobs where source_id in ('t1','t2','t3','t4','t5') or (cursor_info->>'item_id')::int in (7451,7452,7453,7454,7455);
    delete from feedback_items where id in (7451,7452,7453,7454,7455);`)
  const left = await q(`select count(*)::int as n from feedback_items where id in (7451,7452,7453,7454,7455)`)
  console.log(`清理完成，残留 = ${left[0]?.n ?? 0} 条`)
}

// ---------- 主入口 ----------
const phase = process.argv[2] || 'all'
if (phase === 'all' || phase === 'prep') await prep().catch((e) => console.error('prep 失败:', e.message))
if (phase === 'all' || phase === 'api') await apiPhase().catch((e) => report('apiPhase 异常', false, e.message))
if (phase === 'all' || phase === 'verify') await verifyPhase().catch((e) => report('verifyPhase 异常', false, e.message))
if (phase === 'all' || phase === 'clean') await cleanPhase().catch((e) => console.error('clean 失败:', e.message))

const failed = results.filter((r) => !r.pass)
console.log(`\n===== 验收汇总：${results.length - failed.length}/${results.length} 通过 =====`)
if (failed.length) { console.log('未通过项：', failed.map((f) => f.name).join('、')); process.exitCode = 1 }
