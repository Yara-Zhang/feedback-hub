// DeepSeek Chat API（OpenAI 兼容）
const API_KEY = () => Deno.env.get('DEEPSEEK_API_KEY') || ''
const BASE = 'https://api.deepseek.com'

export async function chat(messages: { role: string; content: string }[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const key = API_KEY()
  if (!key) throw new Error('未配置 DEEPSEEK_API_KEY')
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: opts.json ? 0.1 : 0.7,
      max_tokens: opts.maxTokens || 2000,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content || ''
}

export async function chatJson<T>(messages: { role: string; content: string }[], maxTokens?: number): Promise<T> {
  const raw = await chat(messages, { json: true, maxTokens })
  // 容错：截取首个 { 到末个 } 之间内容
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
  const text = s >= 0 && e > s ? raw.slice(s, e + 1) : raw
  return JSON.parse(text) as T
}
