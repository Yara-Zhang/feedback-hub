#!/usr/bin/env node
// Supabase Management API 一键部署脚本（无需本地 supabase CLI）
// 用法：
//   node scripts/deploy.mjs sql        —— 执行数据库 migration
//   node scripts/deploy.mjs secrets     —— 写入函数 secrets
//   node scripts/deploy.mjs functions   —— 打包并部署 7 个 Edge Functions
//   node scripts/deploy.mjs cron        —— 配置 pg_cron 定时任务（先跑 secrets）
//   node scripts/deploy.mjs all         —— 依次执行 sql + secrets + functions + cron
// 配置：scripts/.deploy.env（参照 .deploy.env.example）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.supabase.com/v1'

// ---------- 配置加载 ----------
function loadEnv() {
  const txt = readFileSync(join(ROOT, 'scripts/.deploy.env'), 'utf8')
  const env = {}
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  const required = ['SUPA_ACCESS_TOKEN', 'SUPA_PROJECT_REF']
  for (const k of required) if (!env[k]) throw new Error(`缺少 ${k}，请检查 scripts/.deploy.env`)
  return env
}

const env = loadEnv()
const REF = env.SUPA_PROJECT_REF
const TOKEN = env.SUPA_ACCESS_TOKEN

async function api(path, init = {}) {
  const res = await fetch(`${API}/projects/${REF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(120_000),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`API ${path} ${res.status}: ${String(text).slice(0, 400)}`)
  return data
}

// ---------- SQL：按语句切分（尊重 $$ dollar-quoted 与注释） ----------
function splitSql(sql) {
  const stmts = []
  let cur = '', inDollar = false, inLineComment = false, inBlockComment = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1]
    if (inLineComment) { cur += ch; if (ch === '\n') inLineComment = false; continue }
    if (inBlockComment) { cur += ch; if (ch === '*' && next === '/') { cur += next; i++; inBlockComment = false } continue }
    if (!inDollar && ch === '-' && next === '-') { inLineComment = true; cur += ch; continue }
    if (!inDollar && ch === '/' && next === '*') { inBlockComment = true; cur += ch; continue }
    if (ch === '$' && next === '$') { inDollar = !inDollar; cur += '$$'; i++; continue }
    if (!inDollar && ch === ';') {
      if (cur.trim()) stmts.push(cur.trim() + ';')
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) stmts.push(cur.trim())
  return stmts
}

async function runSqlFile() {
  const sql = readFileSync(join(ROOT, 'supabase/migrations/0001_init.sql'), 'utf8')
  const stmts = splitSql(sql)
  console.log(`migration 切分为 ${stmts.length} 条语句，开始执行…`)
  let ok = 0
  for (let i = 0; i < stmts.length; i++) {
    try {
      await api('/database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: stmts[i] }),
      })
      ok++
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${stmts.length} 完成`)
    } catch (e) {
      const msg = String(e.message)
      // 幂等重跑：已存在对象等错误视为通过
      if (/already exists|duplicate key|does not exist, skipping|conflicts with/i.test(msg)) {
        ok++
        continue
      }
      console.error(`第 ${i + 1} 条语句失败：${stmts[i].slice(0, 120)}…`)
      throw e
    }
  }
  console.log(`✅ SQL 执行完成（${ok}/${stmts.length}）`)
  // 验证
  const tables = await api('/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "select count(*) as n from pg_tables where schemaname='public'" }),
  })
  console.log('public 表数量:', JSON.stringify(tables))
}

// ---------- Secrets ----------
async function setSecrets() {
  const names = ['JWT_SECRET', 'CRON_SECRET', 'TIKHUB_API_KEY', 'DEEPSEEK_API_KEY', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_WEBHOOK_URL', 'FRONTEND_URL']
  const secrets = names.filter((n) => env[n]).map((n) => ({ name: n, value: env[n] }))
  if (!secrets.length) throw new Error('没有可写入的 secrets')
  await api('/secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(secrets),
  })
  console.log(`✅ 已写入 ${secrets.length} 个 secrets`)
}

// ---------- Functions：esbuild 打包单文件 + multipart 部署 ----------
const FUNCTIONS = ['feishu-login', 'crawl-tick', 'api-items', 'api-keywords', 'api-reply', 'api-export', 'weekly-report']

async function deployFunctions() {
  const esbuild = (await import('/Users/mickey/.workbuddy/binaries/node/workspace/node_modules/esbuild/lib/main.js')).default
  const distDir = join(ROOT, '.deploy_dist')
  mkdirSync(distDir, { recursive: true })

  for (const fn of FUNCTIONS) {
    const entry = join(ROOT, `supabase/functions/${fn}/index.ts`)
    const outfile = join(distDir, `${fn}.js`)
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      outfile,
      logLevel: 'error',
    })

    const metaFile = join(distDir, `${fn}.metadata.json`)
    writeFileSync(metaFile, JSON.stringify({ entrypoint_path: 'index.js', name: fn, verify_jwt: false }))

    // 经 curl 上传（Node fetch 的 TLS 在本网络对大请求会被重置，curl 稳定）
    let lastErr
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const out = execSync(
          `curl -s -X POST "${API}/projects/${REF}/functions/deploy?slug=${fn}"` +
          ` -H "Authorization: Bearer ${TOKEN}"` +
          ` -F "metadata=@${metaFile};type=application/json"` +
          ` -F "file=@${outfile};type=text/javascript;filename=index.js"` +
          ` --max-time 150`,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        )
        if (!out.includes('"status"')) throw new Error(out.slice(0, 300))
        if (!/"status":"ACTIVE"/.test(out)) throw new Error(`非 ACTIVE 状态: ${out.slice(0, 300)}`)
        console.log(`✅ ${fn} 部署成功`)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        console.log(`  ${fn} 第 ${attempt} 次尝试失败：${String(e.message || e).slice(0, 120)}，重试…`)
      }
    }
    if (lastErr) throw lastErr
  }
  const list = await api('/functions')
  console.log('当前函数列表:', (Array.isArray(list) ? list : []).map((f) => f.name).join(', '))
}

// ---------- Cron（pg_cron + pg_net + vault） ----------
async function setupCron() {
  if (!env.CRON_SECRET) throw new Error('缺少 CRON_SECRET')
  const fnBase = `https://${REF}.supabase.co/functions/v1`

  // 1. 密钥入 vault（幂等：先删再建）
  const sqls = [
    `select vault.del_secret('feedback_cron_secret');`,
    `select vault.create_secret('${env.CRON_SECRET}', 'feedback_cron_secret');`,
    `select cron.schedule('feedback-crawl-tick', '*/5 * * * *', $$
select net.http_post(
  url := '${fnBase}/crawl-tick',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'feedback_cron_secret')),
  body := '{}'::jsonb
);
$$);`,
    `select cron.schedule('feedback-weekly-report', '30 1 * * 1', $$
select net.http_post(
  url := '${fnBase}/weekly-report',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'feedback_cron_secret')),
  body := '{}'::jsonb
);
$$);`,
  ]
  for (const sql of sqls) {
    try {
      await api('/database/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
      })
    } catch (e) {
      // vault.del_secret 不存在时会报错，忽略
      if (!/does not exist|not found|no secret/i.test(String(e.message))) throw e
    }
  }
  const jobs = await api('/database/query', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select jobname, schedule, active from cron.jobs where jobname like 'feedback-%'` }),
  })
  console.log('✅ 定时任务：', JSON.stringify(jobs))
}

// ---------- 主入口 ----------
const cmd = process.argv[2] || 'all'
if (cmd === 'sql' || cmd === 'all') await runSqlFile()
if (cmd === 'secrets' || cmd === 'all') await setSecrets()
if (cmd === 'functions' || cmd === 'all') await deployFunctions()
if (cmd === 'cron' || cmd === 'all') await setupCron()
console.log('\n🎉 部署步骤完成：', cmd)
