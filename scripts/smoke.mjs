#!/usr/bin/env node
// 通过 pg_net 从数据库内部调用函数做冒烟测试（绕开本地代理网络限制）
// 用法: node scripts/smoke.mjs <path> [method] [body]
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const line of readFileSync(join(ROOT, 'scripts/.deploy.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const { SUPA_ACCESS_TOKEN: TOKEN, SUPA_PROJECT_REF: REF, CRON_SECRET, SUPA_SECRET_KEY } = env

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SQL 执行失败 ${res.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return text }
}

const path = process.argv[2] || '/crawl-tick'
const method = (process.argv[3] || 'POST').toUpperCase()
const body = process.argv[4] || ''

const url = `https://${REF}.supabase.co/functions/v1${path}`
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${CRON_SECRET || SUPA_SECRET_KEY}`,
}
const sql = method === 'GET'
  ? `select net.http_get(url := '${url}', headers := '${JSON.stringify(headers)}'::jsonb) as id;`
  : `select net.http_post(url := '${url}', headers := '${JSON.stringify(headers)}'::jsonb, body := '${(body || '{}').replace(/'/g, "''")}'::jsonb) as id;`

const r = await q(sql)
const id = Array.isArray(r) && r[0]?.id
if (!id) { console.log('请求 ID 获取失败:', JSON.stringify(r).slice(0, 300)); process.exit(1) }

// 等待并从底层响应表读取结果（最多重试 5 次）
let c = null
for (let i = 0; i < 5; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  c = await q(`select status_code, content, error_msg from net._http_response where id = ${id};`)
  if (Array.isArray(c) && c.length) break
}
console.log(`\n=== ${method} ${path} ===`)
console.log(JSON.stringify(c, null, 1).slice(0, 1500))
