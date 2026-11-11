#!/usr/bin/env node
// 同步 CASE 批量 UPDATE（每批一条 SQL，管理 API 同步执行；feedback_items 的
// dedup_hash NOT NULL 导致 PostgREST upsert 不可用；管理 API 有 429 限流，q() 内置退避）
// 用法: node scripts/backfill-painpoint.mjs（幂等，只补 painpoint 为空的 done 条目）
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const line of readFileSync(join(ROOT, 'scripts/.deploy.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const REF = env.SUPA_PROJECT_REF, TOK = env.SUPA_ACCESS_TOKEN, DS_KEY = env.DEEPSEEK_API_KEY, SKEY = env.SUPA_SECRET_KEY
const REST = `https://${REF}.supabase.co/rest/v1/feedback_items`

// 管理 API（带 429 退避重试）
async function q(sql) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(90_000),
    })
    if (res.status === 429) {
      console.log('    管理 API 限流，等 25s 重试…')
      await new Promise((r) => setTimeout(r, 25_000))
      continue
    }
    const t = await res.text()
    if (!res.ok) throw new Error(`SQL 失败 ${res.status}: ${t.slice(0, 300)}`)
    try { return JSON.parse(t) } catch { return t }
  }
  throw new Error('管理 API 持续限流')
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`

// 同步 CASE 批量 UPDATE（每批一条 SQL，管理 API 同步执行；feedback_items 的
// dedup_hash NOT NULL 导致 PostgREST upsert 不可用）
async function updateBatch(pairs) {
  const cases = pairs.map((p) => `when ${p.id} then ${sqlStr(p.pp)}`).join(' ')
  const ids = pairs.map((p) => p.id).join(',')
  await q(`update feedback_items set painpoint = case id ${cases} else painpoint end where id in (${ids});`)
}

const sys = `你是「沉浸式翻译」产品的需求洞察编辑。给你若干条已判定的用户社媒反馈（来自中/日/韩/英语市场），为每条写一句中文大白话痛点标题，直接写明这个用户遇到的问题，≤24 字。
要求：语气直白贴用户口吻（如"看不懂日文漫画，追更三年等不到汉化""AO3 英文小说读得吃力""飞机上看视频没有双语字幕"），禁止技术判定腔（不要"属产品负面口碑"这类分析语）；正面体验就直白写它夸了什么（如"夸漫画翻译是看漫神器"）。
仅输出 JSON：{"results":[{"id":数字,"painpoint":"…"}]}`

async function dsBatch(batch) {
  const input = batch.map((b) => ({
    id: b.id, platform: b.platform, market: b.market, scene: b.ai_scene || '',
    sentiment: b.ai_sentiment || '', topic: b.ai_topic || '', quote: b.ai_quote || '',
    text: String(b.content_text || '').slice(0, 300),
  }))
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${DS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(input) }],
      max_tokens: 3000, temperature: 1.0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return JSON.parse(data.choices[0].message.content).results || []
}

// ---------- 主流程 ----------
const rows = await q(`select id, platform, market, ai_scene, ai_sentiment, ai_topic, ai_quote, content_text
  from feedback_items where ai_status = 'done' and (painpoint is null or painpoint = '') order by id`)
console.log(`待补标 ${rows.length} 条（写回走 PostgREST upsert）`)

let done = 0, failed = 0
const BATCH = 20, CONCURRENCY = 3
const batches = []
for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH))

let cursor = 0
async function worker() {
  while (cursor < batches.length) {
    const my = cursor++
    const batch = batches[my]
    try {
      const results = await dsBatch(batch)
      const pairs = results
        .map((r) => ({ id: Number(r.id), pp: String(r.painpoint || '').trim().slice(0, 40) }))
        .filter((p) => p.id && p.pp)
      if (pairs.length) await updateBatch(pairs)
      done += pairs.length
    } catch (e) {
      failed += batch.length
      console.log(`  批 ${my + 1} 失败：${String(e.message).slice(0, 120)}（跳过，可重跑补齐）`)
    }
    if ((my + 1) % 10 === 0) console.log(`  进度：${Math.min((my + 1) * BATCH, rows.length)}/${rows.length} 已写 ${done}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
console.log(`✅ 补标完成：写回 ${done} 条${failed ? `，失败 ${failed} 条（重跑本脚本可补齐）` : ''}`)
