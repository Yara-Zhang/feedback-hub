// 自签 HMAC-SHA256 JWT（用户会话），不依赖外部库
const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlStr(s: string): string { return b64url(enc.encode(s)) }

function fromB64url(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

export interface SessionPayload {
  sub: number        // users.id
  open_id: string
  name: string
  role: 'admin' | 'member'
  exp: number
}

export async function signJwt(payload: SessionPayload, secret: string): Promise<string> {
  const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const bodyStr = b64urlStr(JSON.stringify(payload))
  const sig = b64url(await hmac(secret, `${header}.${bodyStr}`))
  return `${header}.${bodyStr}.${sig}`
}

export async function verifyJwt(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expect = b64url(await hmac(secret, `${parts[0]}.${parts[1]}`))
  if (expect !== parts[2]) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as SessionPayload
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null
    return payload
  } catch { return null }
}

// 简单 HMAC 签名串（OAuth state 用）
export async function signValue(value: string, secret: string): Promise<string> {
  return b64url(await hmac(secret, value))
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
