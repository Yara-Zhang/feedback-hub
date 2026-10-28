// 飞书开放平台 API 封装
const BASE = 'https://open.feishu.cn'

export function env() {
  return {
    appId: Deno.env.get('FEISHU_APP_ID') || '',
    appSecret: Deno.env.get('FEISHU_APP_SECRET') || '',
    webhook: Deno.env.get('FEISHU_WEBHOOK_URL') || '',
  }
}

async function post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return data as T
}

export async function getAppAccessToken(): Promise<string> {
  const { appId, appSecret } = env()
  const r = await post<{ app_access_token?: string; msg?: string }>(
    '/open-apis/auth/v3/app_access_token/internal',
    { app_id: appId, app_secret: appSecret },
  )
  if (!r.app_access_token) throw new Error(`获取飞书 app_access_token 失败: ${r.msg || '未知错误'}`)
  return r.app_access_token
}

export interface FeishuUser { open_id: string; name: string; avatar_url?: string }

export async function getUserByCode(code: string): Promise<FeishuUser> {
  const appToken = await getAppAccessToken()
  // 换 user_access_token（v2 端点）
  const tokenRes = await post<{ access_token?: string; error?: string; error_description?: string }>(
    '/open-apis/authen/v2/oauth/token',
    { grant_type: 'authorization_code', code },
    appToken,
  )
  if (!tokenRes.access_token) {
    throw new Error(`飞书授权码换取失败: ${tokenRes.error_description || tokenRes.error || '未知错误'}`)
  }
  // 获取用户信息
  const res = await fetch(`${BASE}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${tokenRes.access_token}` },
  })
  const r = await res.json().catch(() => ({})) as { data?: FeishuUser }
  if (!r.data?.open_id) throw new Error('获取飞书用户信息失败')
  return r.data
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const { appId } = env()
  return `${BASE}/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
}

// 群机器人 Webhook：发 interactive 卡片
export async function sendWebhookCard(card: Record<string, unknown>): Promise<void> {
  const { webhook } = env()
  if (!webhook) throw new Error('未配置 FEISHU_WEBHOOK_URL')
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'interactive', card }),
  })
  const r = await res.json().catch(() => ({})) as { StatusCode?: number; statusMessage?: string }
  if (r.StatusCode && r.StatusCode !== 0) throw new Error(`飞书 Webhook 发送失败: ${r.statusMessage || r.StatusCode}`)
}
