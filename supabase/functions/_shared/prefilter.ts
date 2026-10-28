// 本地预筛：排除词过滤 + 命中词判定 + Part A/B 归类 + 简中判定
import { restSelect } from './rest.ts'

export interface KeywordRow {
  id: number; keyword: string; part_type: 'part_a' | 'part_b' | 'exclude'
  group_tag: string; enabled: boolean; hit_count: number
}

let cache: { at: number; rows: KeywordRow[] } = { at: 0, rows: [] }

export async function loadKeywords(): Promise<KeywordRow[]> {
  if (Date.now() - cache.at < 60_000 && cache.rows.length) return cache.rows
  const { data } = await restSelect<KeywordRow>('keywords', { select: '*', enabled: 'eq.true', order: 'id' })
  cache = { at: Date.now(), rows: data }
  return data
}

export interface PrefilterResult {
  relevant: boolean
  partType: 'part_a' | 'part_b'
  matched: string[]
  isSimplifiedChinese: boolean
}

export function prefilter(text: string, keywords: KeywordRow[], platform: string): PrefilterResult {
  const lower = text.toLowerCase()
  const matched: string[] = []
  let partA = false

  for (const k of keywords) {
    const kw = k.keyword.toLowerCase()
    if (k.part_type === 'exclude') {
      if (lower.includes(kw)) return { relevant: false, partType: 'part_b', matched: [], isSimplifiedChinese: true }
    } else {
      if (lower.includes(kw)) {
        matched.push(k.keyword)
        if (k.part_type === 'part_a') partA = true
      }
    }
  }

  // X 平台需要简中过滤；国内平台默认简中环境
  let isZh = true
  if (platform === 'x') {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const cjkAll = (text.match(/[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fff]/g) || []).length
    isZh = cjkAll > 0 && cjk / cjkAll > 0.8  // 汉字占中日韩字符 80% 以上视为简中
  }

  return {
    relevant: matched.length > 0 && isZh,
    partType: partA ? 'part_a' : 'part_b',
    matched,
    isSimplifiedChinese: isZh,
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
