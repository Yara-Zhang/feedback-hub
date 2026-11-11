// 邮箱密码登录（飞书扫码的第二通道，同事无飞书/嫌扫码麻烦时用）
// POST /register {email, password, name?, invite_code?}  → 注册并返回会话
// POST /login    {email, password}                        → 登录返回会话
// 注册需邀请码（app_config.invite_code 非空时校验；置空字符串即开放注册）
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { restSelect, restInsert } from '../_shared/rest.ts'
import { signJwt, safeEqual } from '../_shared/jwt.ts'
import type { SessionPayload } from '../_shared/jwt.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || ''
const SESSION_DAYS = 30
const PBKDF2_ITER = 100_000

const enc = new TextEncoder()
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_')
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256)
  return new Uint8Array(bits)
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt)
  return `${b64(salt)}:${b64(hash)}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(':')
  if (!saltB64 || !hashB64) return false
  try {
    const hash = await pbkdf2(password, fromB64(saltB64))
    return safeEqual(b64(hash), hashB64)
  } catch { return false }
}

async function getConfig(key: string): Promise<string> {
  const { data } = await restSelect<{ value: string }>('app_config', { select: 'value', key: `eq.${key}` }, { single: true })
  return (data?.[0]?.value ?? '') as string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function session(userId: number, name: string, role: string): Promise<string> {
  const payload: SessionPayload = {
    sub: userId, open_id: '', name, role: role as 'admin' | 'member',
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  }
  return signJwt(payload, JWT_SECRET)
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path } = fnPath(req, 'auth-password')

  try {
    // ---------- 注册 ----------
    if (path === '/register' && req.method === 'POST') {
      const b = await body<{ email: string; password: string; name?: string; invite_code?: string }>(req)
      const email = (b.email || '').trim().toLowerCase()
      const password = b.password || ''
      if (!EMAIL_RE.test(email)) return err('邮箱格式不正确')
      if (password.length < 6) return err('密码至少 6 位')

      const invite = await getConfig('invite_code')
      if (invite && !safeEqual(String(b.invite_code || ''), invite)) {
        return err('邀请码不正确，请向管理员索取', 403)
      }

      const { data: dup } = await restSelect('users', { select: 'id', email: `eq.${email}` }, { single: true })
      if (dup?.length) return err('该邮箱已注册，请直接登录', 409)

      const hash = await hashPassword(password)
      const name = (b.name || '').trim().slice(0, 30) || email.split('@')[0]
      // feishu_open_id 为 unique not null：邮箱用户用 pwd:{email} 占位
      const inserted = await restInsert<{ id: number; role: string }>('users', {
        feishu_open_id: `pwd:${email}`, name, role: 'member', email, password_hash: hash,
      })
      const u = inserted[0]
      const token = await session(u.id, name, u.role || 'member')
      return json({ token, user: { id: u.id, name, role: u.role || 'member' } })
    }

    // ---------- 登录 ----------
    if (path === '/login' && req.method === 'POST') {
      const b = await body<{ email: string; password: string }>(req)
      const email = (b.email || '').trim().toLowerCase()
      const { data: rows } = await restSelect<{ id: number; name: string; role: string; password_hash: string | null }>('users', {
        select: 'id,name,role,password_hash', email: `eq.${email}`,
      }, { single: true })
      const u = rows?.[0]
      if (!u || !u.password_hash) return err('邮箱未注册或密码未设置', 401)
      if (!(await verifyPassword(b.password || '', u.password_hash))) return err('密码不正确', 401)
      const token = await session(u.id, u.name, u.role)
      return json({ token, user: { id: u.id, name: u.name, role: u.role } })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '请求失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '内部错误', 500)
  }
})
