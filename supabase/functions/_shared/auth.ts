// 请求鉴权：用户 JWT（自签）/ Supabase service key / CRON_SECRET（数据库定时任务）
import { verifyJwt, type SessionPayload } from './jwt.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

export function isServiceRequest(req: Request): boolean {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!auth || !token) return false
  if (SERVICE_KEY && token === SERVICE_KEY) return true
  if (CRON_SECRET && token === CRON_SECRET) return true
  return false
}

export async function getSession(req: Request): Promise<SessionPayload | null> {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token || token === SERVICE_KEY) return null
  return await verifyJwt(token, JWT_SECRET)
}

export async function requireUser(req: Request): Promise<SessionPayload> {
  const s = await getSession(req)
  if (!s) throw new AuthError('未登录或登录已过期', 401)
  return s
}

export async function requireAdmin(req: Request): Promise<SessionPayload> {
  const s = await requireUser(req)
  if (s.role !== 'admin') throw new AuthError('需要管理员权限', 403)
  return s
}

// 用户 JWT 或 service key（定时任务允许）
export async function requireUserOrService(req: Request): Promise<SessionPayload | { service: true }> {
  if (isServiceRequest(req)) return { service: true }
  return await requireUser(req)
}

export async function requireAdminOrService(req: Request): Promise<SessionPayload | { service: true }> {
  if (isServiceRequest(req)) return { service: true }
  return await requireAdmin(req)
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) { super(message); this.status = status }
}
