// 本地预筛：排除词过滤 + 命中词判定 + Part A/B 归类 + 简中判定 + 市场判定
import { restSelect } from './rest.ts'

export interface KeywordRow {
  id: number; keyword: string; part_type: 'part_a' | 'part_b' | 'exclude'
  group_tag: string; enabled: boolean; hit_count: number
  market?: string // cn / en / jp / kr（0002 起有值，旧数据默认 cn）
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
  kwMarket: string | null // 命中词中第一个非中文市场的市场标记（en/jp/kr），全中文词为 null
}

// 关键词命中：连续串包含；带空格的多词关键词（英文/日韩词组）按分词 AND 全命中
function kwHit(lowerText: string, kw: string): boolean {
  if (kw.includes(' ')) {
    return kw.split(/\s+/).filter(Boolean).every((t) => lowerText.includes(t))
  }
  return lowerText.includes(kw)
}

export function prefilter(text: string, keywords: KeywordRow[], platform: string): PrefilterResult {
  const lower = text.toLowerCase()
  const matched: string[] = []
  let partA = false
  let kwMarket: string | null = null

  for (const k of keywords) {
    const kw = k.keyword.toLowerCase()
    if (k.part_type === 'exclude') {
      if (kwHit(lower, kw)) return { relevant: false, partType: 'part_b', matched: [], isSimplifiedChinese: true, kwMarket: null }
    } else {
      if (kwHit(lower, kw)) {
        matched.push(k.keyword)
        if (k.part_type === 'part_a') partA = true
        if (!kwMarket && k.market && k.market !== 'cn') kwMarket = k.market
      }
    }
  }

  // X 平台需要简中过滤；但外语市场关键词（en/jp/kr）本身就是外语求助词，跳过简中检查
  let isZh = true
  if (platform === 'x' && !kwMarket) {
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const cjkAll = (text.match(/[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fff]/g) || []).length
    isZh = cjkAll > 0 && cjk / cjkAll > 0.8  // 汉字占中日韩字符 80% 以上视为简中
  }

  return {
    relevant: matched.length > 0 && isZh,
    partType: partA ? 'part_a' : 'part_b',
    matched,
    isSimplifiedChinese: isZh,
    kwMarket,
  }
}

// 内容语言判定：假名占 CJK ≥30% → ja（日语助词必有假名；中文帖仅引用少量日语词时占比低）/ 谚文同理 ko / 汉字→zh / 拉丁→en
export function detectLang(text: string): 'zh' | 'ja' | 'ko' | 'en' | null {
  const s = text || ''
  const kana = (s.match(/[\u3040-\u30ff]/g) || []).length
  const hangul = (s.match(/[\uac00-\ud7af]/g) || []).length
  const han = (s.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (s.match(/[A-Za-z]/g) || []).length
  const cjkAll = kana + hangul + han
  if (cjkAll > 0 && kana / cjkAll >= 0.3) return 'ja'
  if (cjkAll > 0 && hangul / cjkAll >= 0.3) return 'ko'
  if (han >= 2) return 'zh'
  if (latin > 10) return 'en'
  return null
}

// 市场判定（优先级：关键词显式市场 > 内容语言 > 平台兜底）
export function marketOf(kwMarket: string | null, lang: string | null, platform: string): 'cn' | 'en' | 'jp' | 'kr' {
  if (kwMarket && kwMarket !== 'cn') return kwMarket as 'en' | 'jp' | 'kr'
  if (lang === 'ja') return 'jp'
  if (lang === 'ko') return 'kr'
  if (lang === 'en') return 'en'
  if (lang === 'zh') return 'cn'
  if (platform === 'reddit') return 'en'
  return 'cn'
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
