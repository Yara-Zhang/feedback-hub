// PostgREST 轻量客户端（service role 直连，绕过 RLS）
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const e = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return e.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
}

export async function restSelect<T = Record<string, unknown>>(
  table: string, params: Record<string, string | number | undefined | null>,
  opts: { single?: boolean; count?: boolean } = {},
): Promise<{ data: T[]; count: number }> {
  const prefer = opts.count ? 'count=exact' : ''
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs(params)}`, {
    headers: headers(prefer ? { Prefer: prefer } : {}),
  })
  if (!res.ok) throw new Error(`restSelect ${table} ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as T[]
  let count = data.length
  const range = res.headers.get('content-range')
  if (opts.count && range) count = parseInt(range.split('/')[1] || '0', 10) || 0
  return { data: opts.single ? data.slice(0, 1) : data, count }
}

export async function restInsert<T = Record<string, unknown>>(
  table: string, rows: Record<string, unknown>[] | Record<string, unknown>,
  opts: { onConflict?: string; ignoreDuplicates?: boolean } = {},
): Promise<T[]> {
  const prefer: string[] = ['return=representation']
  if (opts.ignoreDuplicates) prefer.push(`resolution=${opts.ignoreDuplicates ? 'ignore' : 'merge'}-duplicates`)
  const url = opts.onConflict
    ? `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${opts.onConflict}`
    : `${SUPABASE_URL}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers({ Prefer: prefer.join(',') }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  })
  if (!res.ok) throw new Error(`restInsert ${table} ${res.status}: ${await res.text()}`)
  try { return (await res.json()) as T[] } catch { return [] }
}

export async function restPatch<T = Record<string, unknown>>(
  table: string, filters: Record<string, string>, patch: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs(filters)}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`restPatch ${table} ${res.status}: ${await res.text()}`)
  try { return (await res.json()) as T[] } catch { return [] }
}

export async function restDelete(table: string, filters: Record<string, string>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs(filters)}`, {
    method: 'DELETE',
    headers: headers(),
  })
  if (!res.ok) throw new Error(`restDelete ${table} ${res.status}: ${await res.text()}`)
}

export async function restRpc<T = unknown>(fn: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`restRpc ${fn} ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}
