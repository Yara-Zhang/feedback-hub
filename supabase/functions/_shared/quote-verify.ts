// 卡点原句核验：防 LLM 幻觉摘句（移植机会卡牌 demandGate squash 逻辑 + 三字符片段兜底）
// 用途：AI 打标摘出的「发帖人本人卡在语言/翻译上」的原话，必须在原文中真实存在

// 标准化：小写 + 去空白/标点/符号（\s \p{P} \p{S}）
export function squash(s: string): string {
  return (s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 核验摘出的原句是否真的出现在原文里。
 * - squash 后整串包含 → 通过
 * - 否则拆连续三字符片段，60% 命中率兜底（容忍 LLM 轻度拼接/顺序调整）
 * - 返回 null 表示无从核验（quote 为空，调用方存 null 区分「没摘」与「未命中」）
 */
export function verifyQuote(quote: string | null | undefined, rawText: string): boolean | null {
  if (!quote) return null
  const q = squash(quote)
  if (q.length < 4) return false // 太短无从核验
  const raw = squash(rawText)
  if (!raw) return false
  if (raw.includes(q)) return true
  const frags: string[] = []
  for (let i = 0; i <= q.length - 3; i++) frags.push(q.slice(i, i + 3))
  if (!frags.length) return false
  const hits = frags.filter((f) => raw.includes(f)).length
  return hits / frags.length >= 0.6
}

// 去噪声：URL / 话题标签 / @提及（供正文长度类检查用，可选）
export function stripNoise(raw: string): string {
  return (raw || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#＃][^\s#＃]+/g, '')
    .replace(/@\S+/g, '')
}
