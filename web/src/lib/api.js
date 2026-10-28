import { FUNCTIONS_BASE, SUPABASE_ANON_KEY } from './config'

const TOKEN_KEY = 'fh_token'
const USER_KEY = 'fh_user'

export function getToken() { return localStorage.getItem(TOKEN_KEY) || '' }
export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}

async function call(fn, path, { method = 'GET', body, params } = {}) {
  let url = `${FUNCTIONS_BASE}/${fn}${path || ''}`
  if (params) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined))
    const s = qs.toString()
    if (s) url += `?${s}`
  }
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) { clearSession(); window.location.href = '/'; throw new Error('登录已过期，请重新登录') }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `请求失败(${res.status})`)
  return data
}

// 飞书登录跳转（后端返回授权 URL）
export async function getFeishuAuthUrl(redirectOrigin) {
  return call('feishu-login', '/authorize', { params: { redirect_origin: redirectOrigin } })
}

// ===== 反馈条目 =====
export const api = {
  items: {
    list: (filters) => call('api-items', '/list', { params: filters }),
    detail: (id) => call('api-items', `/${id}`),
    claim: (id) => call('api-items', `/${id}/claim`, { method: 'POST' }),
    setStatus: (id, status) => call('api-items', `/${id}/status`, { method: 'POST', body: { status } }),
    drafts: (id) => call('api-reply', `/${id}/drafts`),
    generateDraft: (id, draft_type, tone) => call('api-reply', `/${id}/generate`, { method: 'POST', body: { draft_type, tone } }),
    saveDraft: (id, draft_type, content) => call('api-reply', `/${id}/drafts`, { method: 'POST', body: { draft_type, content } })
  },
  keywords: {
    list: () => call('api-keywords', '/list'),
    create: (body) => call('api-keywords', '', { method: 'POST', body }),
    update: (id, body) => call('api-keywords', `/${id}`, { method: 'PATCH', body }),
    remove: (id) => call('api-keywords', `/${id}`, { method: 'DELETE' })
  },
  crawl: {
    status: () => call('crawl-tick', '/status'),
    triggerNow: () => call('crawl-tick', '/trigger', { method: 'POST' }),
    setBudget: (n) => call('crawl-tick', '/trigger', { method: 'POST', body: { set_daily_budget: n } })
  },
  users: {
    list: () => call('api-items', '/users/list'),
    setRole: (id, role) => call('api-items', '/users/role', { method: 'POST', body: { id, role } })
  },
  report: {
    preview: () => call('weekly-report', '/preview')
  },
  me: () => call('api-items', '/me'),
  exportUrl: (scope) => {
    const qs = new URLSearchParams({ ...(scope || {}) })
    return `${FUNCTIONS_BASE}/api-export/export?${qs.toString()}&token=${encodeURIComponent(getToken())}`
  }
}
