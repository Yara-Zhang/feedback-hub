// TikHub API 统一客户端：认证 + 用量计数 + 超时重试
import { restRpc } from '../rest.ts'

const BASE = 'https://api.tikhub.io'
// 小红书等接口对 UA 敏感，统一带浏览器 UA
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

let lastUsageInc = 0

export async function tikhubGet(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  const key = Deno.env.get('TIKHUB_API_KEY') || ''
  if (!key) throw new Error('未配置 TIKHUB_API_KEY')

  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, 'User-Agent': UA },
        signal: AbortSignal.timeout(25_000),
      })
      if (res.status === 429) throw new Error('TikHub 限流(429)')
      const json = await res.json().catch(() => { throw new Error(`TikHub 响应非 JSON(${res.status})`) })
      // 用量计数（限频 1 次/秒，失败忽略）
      if (Date.now() - lastUsageInc > 1000) {
        lastUsageInc = Date.now()
        restRpc('inc_usage', { p_tikhub: 1 }).catch(() => {})
      }
      // TikHub 常见包装：{ code: 200, data: ..., message }
      if (json && typeof json === 'object' && 'code' in (json as Record<string, unknown>)) {
        const code = (json as { code: number }).code
        if (code !== 200) throw new Error(`TikHub 业务错误 code=${code}: ${JSON.stringify(json).slice(0, 200)}`)
      }
      return json
    } catch (e) {
      lastErr = e
      if (attempt === 0) await sleep(2000)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// 按路径逐层取值，任意一层失败返回 undefined
export function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

// 兼容多层数据结构：TikHub 各端点返回层级不完全一致
export function firstArray(obj: unknown, ...paths: string[][]): unknown[] {
  for (const p of paths) {
    const v = dig(obj, ...p)
    if (Array.isArray(v) && v.length) return v
  }
  for (const p of paths) {
    const v = dig(obj, ...p)
    if (Array.isArray(v)) return v
  }
  return []
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normTime(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') {
    // unix 秒/毫秒
    const ms = v > 1e12 ? v : v * 1000
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  }
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!isNaN(t)) return new Date(t).toISOString().slice(0, 19).replace('T', ' ')
    return v.slice(0, 19)
  }
  return undefined
}
