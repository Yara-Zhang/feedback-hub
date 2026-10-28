// ===== 环境配置 =====
// 部署时通过 .env.production 或 GitHub Actions 注入
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
export const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`

// ===== 平台/枚举展示配置 =====
export const PLATFORMS = {
  xhs: { label: '小红书', color: 'bg-red-100 text-red-600', icon: '📕' },
  wb: { label: '微博', color: 'bg-orange-100 text-orange-600', icon: '🟠' },
  bili: { label: 'B站', color: 'bg-blue-100 text-blue-600', icon: '📺' },
  dy: { label: '抖音', color: 'bg-neutral-800 text-white', icon: '🎵' },
  x: { label: 'X', color: 'bg-slate-800 text-white', icon: '𝕏' }
}

export const CONTENT_TYPES = {
  video: '视频', note: '笔记', post: '帖子', comment: '评论'
}

export const PART_TYPES = { part_a: '沉浸式翻译相关', part_b: '全量场景' }

export const SCENES = { comic: '漫画', novel: '小说/AO3', video: '视频', other: '其他' }

export const PRIORITIES = {
  p0: { label: 'P0', cls: 'bg-red-100 text-red-700', desc: '高价值/需尽快处理' },
  p1: { label: 'P1', cls: 'bg-amber-100 text-amber-700', desc: '有价值' },
  p2: { label: 'P2', cls: 'bg-slate-100 text-slate-600', desc: '一般' }
}

export const STATUSES = {
  new: '待处理', claimed: '已认领', processed: '已处理', ignored: '已忽略'
}

export const SENTIMENTS = { positive: '正面', neutral: '中性', negative: '负面' }

export const USE_TAGS = {
  pr_material: '宣发素材', feature_opportunity: '功能机会',
  negative_pr: '负面口碑需处理', kol_lead: 'KOL线索', competitor: '竞品提及'
}
