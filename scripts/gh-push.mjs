#!/usr/bin/env node
// 经 GitHub Git Data API 推送本地提交（绕开 github.com:443 git 通道不通的问题）
// 用法: GH_TOKEN=xxx node scripts/gh-push.mjs <owner>/<repo> [branch]
import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const repo = process.argv[2]
const branch = process.argv[3] || 'main'
// GH_TOKEN 优先环境变量，其次读 scripts/.deploy.env（已 gitignore）
let TOKEN = process.env.GH_TOKEN
if (!TOKEN) {
  try {
    for (const line of readFileSync(join(ROOT, 'scripts/.deploy.env'), 'utf8').split('\n')) {
      const m = line.match(/^GH_TOKEN=(.*)$/)
      if (m) { TOKEN = m[1].trim(); break }
    }
  } catch { /* 文件不存在则忽略 */ }
}
if (!repo || !TOKEN) { console.error('用法: GH_TOKEN=xxx node scripts/gh-push.mjs <owner>/<repo> [branch]'); process.exit(1) }

const api = async (path, init = {}) => {
  for (let i = 1; i <= 5; i++) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers || {}),
        },
        signal: AbortSignal.timeout(60_000),
      })
      const text = await res.text()
      if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`)
      try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } } catch { return { ok: res.ok, status: res.status, data: text } }
    } catch (e) {
      if (i === 5) throw e
      await new Promise((r) => setTimeout(r, i * 2000))
    }
  }
}

// 本地待推文件
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
console.log(`待推送 ${files.length} 个文件`)

// 1. 逐个创建 blob
const tree = []
for (const f of files) {
  const content = readFileSync(join(ROOT, f)).toString('base64')
  const isBinary = f.endsWith('.png') || f.endsWith('.ico')
  const r = await api('/git/blobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isBinary ? { content, encoding: 'base64' } : { content: Buffer.from(content, 'base64').toString('utf8'), encoding: 'utf-8' }),
  })
  if (!r.ok) throw new Error(`blob 失败: ${f} ${JSON.stringify(r.data).slice(0, 200)}`)
  tree.push({ path: f, mode: '100644', type: 'blob', sha: r.data.sha })
  if (tree.length % 10 === 0) console.log(`  blob ${tree.length}/${files.length}`)
}
console.log(`blob 全部创建完成（${tree.length}）`)

// 2. 远端分支是否存在
const ref = await api(`/git/ref/heads/${branch}`)
let parentSha = null, baseTree = null
if (ref.ok && ref.data?.object?.sha) {
  parentSha = ref.data.object.sha
  const ci = await api(`/git/commits/${parentSha}`)
  baseTree = ci.data?.tree?.sha
  console.log(`远端分支已存在，parent=${parentSha.slice(0, 8)}`)
} else {
  console.log('远端分支不存在，将创建新分支')
}

// 3. 创建 tree
const tr = await api('/git/trees', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ base_tree: baseTree || undefined, tree }),
})
if (!tr.ok) throw new Error(`tree 失败: ${JSON.stringify(tr.data).slice(0, 300)}`)
console.log(`tree 创建成功: ${tr.data.sha.slice(0, 8)}`)

// 4. 创建 commit
const msg = execSync('git log -1 --pretty=%B', { cwd: ROOT, encoding: 'utf8' }).trim()
const cr = await api('/git/commits', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: msg, tree: tr.data.sha, parents: parentSha ? [parentSha] : [] }),
})
if (!cr.ok) throw new Error(`commit 失败: ${JSON.stringify(cr.data).slice(0, 300)}`)
console.log(`commit 创建成功: ${cr.data.sha.slice(0, 8)}`)

// 5. 更新/创建分支引用
const ur = ref.ok
  ? await api(`/git/refs/heads/${branch}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: cr.data.sha, force: true }) })
  : await api('/git/refs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: cr.data.sha }) })
if (!ur.ok) throw new Error(`更新引用失败: ${JSON.stringify(ur.data).slice(0, 300)}`)
console.log(`✅ 分支 ${branch} 已更新到 ${cr.data.sha.slice(0, 8)}`)
