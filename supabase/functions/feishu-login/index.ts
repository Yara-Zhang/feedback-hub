// 飞书扫码登录：/authorize 发起 → /callback 换取用户信息 → 签发会话 JWT → 重定向前端
import { preflight, json, err, fnPath } from '../_shared/cors.ts'
import { authorizeUrl, getUserByCode } from '../_shared/feishu.ts'
import { restSelect, restInsert } from '../_shared/rest.ts'
import { signJwt, signValue, safeEqual } from '../_shared/jwt.ts'
import type { SessionPayload } from '../_shared/jwt.ts'

const JWT_SECRET = Deno.env.get('JWT_SECRET') || ''
const SESSION_DAYS = 30

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path, url } = fnPath(req, 'feishu-login')

  try {
    // ---- 发起授权 ----
    if (path === '/authorize' && req.method === 'GET') {
      const redirectOrigin = url.searchParams.get('redirect_origin') || ''
      if (!/^https?:\/\//.test(redirectOrigin)) return err('redirect_origin 不合法')
      // 分隔符用 |（encodeURIComponent 不会转义域名中的 . ，会把 | 转义，故 | 不会出现在编码后的 origin 里）
      const state = `${encodeURIComponent(redirectOrigin)}|${await signValue(redirectOrigin, JWT_SECRET)}`
      const callbackUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/feishu-login/callback`
      return json({ url: authorizeUrl(callbackUri, state) })
    }

    // ---- OAuth 回调 ----
    if (path === '/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state') || ''
      const [rawOrigin, sig] = state.split('|')
      const redirectOrigin = decodeURIComponent(rawOrigin || '')
      if (!code || !redirectOrigin) return err('缺少 code 或 state')

      // 校验 state 签名（防 CSRF / 防篡改跳转）
      const expectSig = await signValue(redirectOrigin, JWT_SECRET)
      if (!sig || !safeEqual(sig, expectSig)) return err('state 校验失败', 403)

      // 换取飞书用户
      const fu = await getUserByCode(code)

      // upsert 内部用户（首个用户自动成为管理员）
      const { data: existing } = await restSelect<{ id: number; role: string }>('users', {
        select: 'id,role', feishu_open_id: `eq.${fu.open_id}`,
      }, { single: true })
      let userId: number, role: string
      if (existing?.length) {
        userId = existing[0].id
        role = existing[0].role
      } else {
        const { data: all } = await restSelect('users', { select: 'id' })
        role = (!all || all.length === 0) ? 'admin' : 'member'
        const inserted = await restInsert<{ id: number }>('users', {
          feishu_open_id: fu.open_id, name: fu.name || '同事', avatar_url: fu.avatar_url || null, role,
        })
        userId = inserted[0].id
      }

      // 签发会话 JWT
      const payload: SessionPayload = {
        sub: userId, open_id: fu.open_id, name: fu.name || '同事',
        role: role as 'admin' | 'member',
        exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
      }
      const token = await signJwt(payload, JWT_SECRET)
      const user = { id: userId, name: payload.name, avatar_url: fu.avatar_url, role }

      // 重定向回前端登录页（hash 路由，GitHub Pages 静态托管下不会 404）
      const target = `${redirectOrigin.replace(/\/$/, '')}/#/login?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(user))}`
      return new Response(null, { status: 302, headers: { Location: target } })
    }

    return err('未知路径', 404)
  } catch (e) {
    // 回调阶段错误重定向回登录页带错误信息
    if (path === '/callback') {
      const [rawOrigin] = (url.searchParams.get('state') || '').split('|')
      const origin = decodeURIComponent(rawOrigin || '')
      if (/^https?:\/\//.test(origin)) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${origin.replace(/\/$/, '')}/#/login?err=${encodeURIComponent(e.message)}` },
        })
      }
    }
    return err(e instanceof Error ? e.message : '登录失败', 500)
  }
})
