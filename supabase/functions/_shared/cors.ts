// CORS 处理：内部工具，允许所有来源（鉴权靠 JWT）
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

// 解析函数内路径，兼容多种 Edge Runtime 路径格式：
//   /functions/v1/<fn>/a/b → /a/b（旧格式）
//   /<fn>/a/b              → /a/b（新格式：无 functions/v1 前缀）
//   /a/b                   → /a/b（已剥离函数名）
export function fnPath(req: Request, ownName?: string): { path: string; url: URL } {
  const url = new URL(req.url)
  let p = url.pathname.replace(/^\/functions\/v1\/[^/]+/, '')
  if (ownName) {
    p = p.replace(new RegExp(`^/${ownName}(?=/|$)`), '')
  }
  return { path: p, url }
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return await req.json() as T } catch { return {} as T }
}
