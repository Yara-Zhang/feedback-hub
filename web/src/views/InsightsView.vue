<template>
  <div class="min-h-screen bg-[#f8f9fc]">
    <!-- ===== 顶部品牌条 ===== -->
    <div class="bg-gradient-to-r from-slate-900 via-indigo-950 to-indigo-900 text-white">
      <div class="max-w-5xl mx-auto px-6 py-8 flex items-end justify-between">
        <div>
          <div class="flex items-center gap-3">
            <span class="text-3xl">📡</span>
            <h1 class="text-2xl font-bold tracking-wide">痛点雷达</h1>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-white/15 border border-white/20 tracking-widest uppercase">Pain Radar</span>
          </div>
          <p class="mt-2 text-sm text-indigo-200">翻译场景用户需求洞察 · 中 / 英 / 日 / 韩 · 7 大平台实时扫描</p>
        </div>
        <router-link to="/"
          class="text-xs px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-indigo-100 hover:bg-white/20 transition">
          进入协作工作台 →
        </router-link>
      </div>

      <!-- 统计带 -->
      <div class="max-w-5xl mx-auto px-6 pb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div v-for="s in statCards" :key="s.label"
          class="rounded-xl bg-white/10 border border-white/15 px-4 py-3 backdrop-blur">
          <div class="text-xl font-bold" :class="s.accent ? 'text-rose-300' : 'text-white'">{{ s.value }}</div>
          <div class="text-[11px] text-indigo-200 mt-0.5">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <!-- ===== 过滤带（sticky） ===== -->
    <div class="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
      <div class="max-w-5xl mx-auto px-6 py-3 space-y-2.5">
        <div class="flex items-center gap-1 flex-wrap">
          <button v-for="t in tabs" :key="t.key" @click="tab = t.key"
            class="px-3.5 py-1.5 rounded-full text-sm transition border"
            :class="tab === t.key
              ? 'bg-indigo-600 text-white border-indigo-600 font-medium shadow'
              : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'">
            {{ t.label }}
          </button>
          <div class="flex-1"></div>
          <div class="relative">
            <input v-model="q" placeholder="搜痛点关键词 / 作者…" class="input !py-1.5 w-56 !pl-8 text-sm"
              @keyup.enter="reload">
            <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          </div>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap text-sm">
          <button v-for="m in marketPills" :key="m.key" @click="market = m.key"
            class="px-3 py-1 rounded-lg transition text-xs font-medium"
            :class="market === m.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'">
            {{ m.label }}
          </button>
          <span class="w-px h-4 bg-slate-200 mx-1"></span>
          <select v-model="scene" class="input !py-1 !pr-6 text-xs w-28">
            <option value="">全部场景</option>
            <option v-for="(l, k) in SCENES" :key="k" :value="k">{{ l }}</option>
          </select>
          <select v-model="platform" class="input !py-1 !pr-6 text-xs w-32">
            <option value="">全部平台</option>
            <option v-for="(p, k) in PLATFORMS" :key="k" :value="k">{{ p.label }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- ===== 话题雷达条 ===== -->
    <div v-if="topicChips.length" class="max-w-5xl mx-auto px-6 pt-5">
      <div class="flex items-center gap-1.5 mb-2 text-xs text-slate-400">
        <span class="animate-pulse text-rose-500">🔴</span> 热点话题 · {{ activeTopic ? '正在聚焦' : '点击聚焦同类痛点' }}
        <button v-if="activeTopic" class="text-indigo-600 hover:underline ml-1" @click="activeTopic = ''; reload()">✕ 取消聚焦</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-for="t in topicChips" :key="t.topic" @click="activeTopic = t.topic; reload()"
          class="group flex items-center gap-2 px-3.5 py-1.5 rounded-full border transition bg-white"
          :class="activeTopic === t.topic
            ? 'border-indigo-500 bg-indigo-50 shadow-sm'
            : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40'">
          <span class="text-sm text-slate-700 group-hover:text-indigo-700">{{ t.topic }}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            :class="t.count >= 3 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'">
            {{ t.count }} 人同此痛
          </span>
        </button>
      </div>
    </div>

    <!-- ===== 痛点卡片流 ===== -->
    <div class="max-w-3xl mx-auto px-6 py-6 space-y-4">
      <div v-if="loading && !items.length" class="space-y-4">
        <div v-for="i in 4" :key="i" class="card p-6 animate-pulse">
          <div class="h-4 w-24 bg-slate-100 rounded mb-4"></div>
          <div class="h-6 w-3/4 bg-slate-100 rounded mb-3"></div>
          <div class="h-3 w-full bg-slate-50 rounded mb-2"></div>
          <div class="h-3 w-2/3 bg-slate-50 rounded"></div>
        </div>
      </div>

      <p v-else-if="emptyContext" class="text-center py-16 text-sm text-slate-400">
        <template v-if="emptyContext.queued_jobs > 0">
          雷达扫描中 —— 抓取队列还有 {{ emptyContext.queued_jobs }} 个任务在跑，
          有 {{ emptyContext.pending_tagging }} 条新反馈等待 AI 打标，稍后再来 ✨
        </template>
        <template v-else-if="emptyContext.last_item_at">
          当前筛选条件下暂无痛点（最近一条抓取于 {{ (emptyContext.last_item_at || '').slice(0, 16).replace('T', ' ') }}）
        </template>
        <template v-else>当前筛选条件下暂无痛点</template>
      </p>

      <article v-for="it in items" :key="it.id" class="pain-card group">
        <!-- 徽章行 -->
        <div class="flex items-center gap-2 flex-wrap text-xs">
          <span v-if="it.ai_priority" class="px-2 py-0.5 rounded-full font-bold"
            :class="it.ai_priority === 'p0' ? 'bg-rose-500 text-white shadow-sm shadow-rose-200'
              : it.ai_priority === 'p1' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'">
            {{ it.ai_priority?.toUpperCase() }}
          </span>
          <span v-if="it.ai_sentiment === 'negative'" class="px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100">⚠️ 负面口碑</span>
          <span v-else-if="it.ai_sentiment === 'positive'" class="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">💚 正面体验</span>
          <span class="px-2 py-0.5 rounded-full border" :class="(MARKETS[it.market || 'cn'] || MARKETS.cn).cls">{{ (MARKETS[it.market || 'cn'] || MARKETS.cn).label }}</span>
          <span class="px-2 py-0.5 rounded-full border" :class="(PLATFORMS[it.platform] || {}).color">{{ (PLATFORMS[it.platform] || {}).icon }} {{ (PLATFORMS[it.platform] || {}).label || it.platform }}</span>
          <div class="flex-1"></div>
          <span class="text-slate-400 text-[11px]">♥ {{ engagement(it) }} 互动 · {{ timeAgo(it) }}</span>
        </div>

        <!-- 痛点大标题 -->
        <h2 class="mt-3 text-[19px] leading-snug font-bold text-slate-800 group-hover:text-indigo-700 transition">
          {{ painTitle(it) }}
        </h2>

        <!-- 用户原话 -->
        <blockquote v-if="it.ai_quote" class="mt-3 pl-4 pr-3 py-2.5 rounded-r-lg bg-indigo-50/70 border-l-[3px] border-indigo-400">
          <p class="text-[15px] text-slate-700 leading-relaxed">“{{ it.ai_quote }}”</p>
          <p class="mt-1.5 text-[11px] text-slate-400">
            —— {{ it.author_name || '匿名用户' }} 的原话
            <span v-if="it.ai_verified" class="ml-1 text-emerald-600">✓ 已核验原文</span>
            <span v-else-if="it.ai_verified === false" class="ml-1 text-amber-500">⚠ 未核验，请以原文为准</span>
          </p>
        </blockquote>

        <!-- 内容摘要（有 quote 时折叠两行） -->
        <p class="mt-3 text-sm text-slate-500 leading-relaxed"
          :class="it.ai_quote ? 'line-clamp-2' : ''">
          {{ (it.content_text || '').replace(/\s+/g, ' ').slice(0, it.ai_quote ? 220 : 160) }}…
        </p>

        <!-- 元信息 + 操作 -->
        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap text-xs">
          <button v-if="it.ai_topic" class="text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md hover:bg-indigo-100 transition"
            @click="activeTopic = it.ai_topic; reload()">
            # {{ it.ai_topic }}
          </button>
          <span v-if="it.ai_scene && it.ai_scene !== 'other'" class="text-slate-400"># {{ SCENES[it.ai_scene] || it.ai_scene }}</span>
          <span v-if="it.ai_confidence != null && it.ai_confidence < 0.7" class="text-amber-500">低置信 {{ Math.round((it.ai_confidence || 0) * 100) }}%</span>
          <div class="flex-1"></div>
          <span class="px-2 py-0.5 rounded-md" :class="statusCls(it.status)">{{ STATUSES[it.status] || it.status }}</span>
          <a :href="it.source_url" target="_blank" rel="noopener"
            class="px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-indigo-700 transition font-medium">查看原帖 ↗</a>
          <router-link :to="`/item/${it.id}`"
            class="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-indigo-400 hover:text-indigo-600 transition font-medium">
            {{ it.status === 'new' ? '认领处理' : '查看处理进展' }}
          </router-link>
        </div>
      </article>

      <!-- 加载更多 -->
      <div class="pt-2 pb-16 text-center">
        <button v-if="hasMore && !loading" @click="loadMore" class="btn-primary justify-center px-8">加载更多痛点 ↓</button>
        <p v-else-if="!hasMore && items.length" class="text-xs text-slate-400">—— 已到底，共 {{ total }} 条 ——</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../lib/api'
import { MARKETS, PLATFORMS, SCENES, STATUSES } from '../lib/config'

// ---- 状态 ----
const items = ref([])
const total = ref(0)
const stats = ref({})
const groups = ref([])
const emptyContext = ref(null)
const loading = ref(true)
const page = ref(1)
const hasMore = ref(true)

const tab = ref('all')
const market = ref('')
const scene = ref('')
const platform = ref('')
const q = ref('')
const activeTopic = ref('')

const tabs = [
  { key: 'all', label: '全部痛点' },
  { key: 'p0', label: '🔥 P0 火速' },
  { key: 'negative', label: '⚠️ 负面口碑' },
  { key: 'feature_opportunity', label: '💡 功能机会' },
  { key: 'pr_material', label: '⭐ 宣发素材' },
  { key: 'kol_lead', label: '👋 KOL 线索' },
]
const marketPills = [
  { key: '', label: '全部市场' },
  { key: 'cn', label: '中文' }, { key: 'en', label: '英文' },
  { key: 'jp', label: '日文' }, { key: 'kr', label: '韩文' },
]

const statCards = computed(() => [
  { label: '近 7 天新增', value: stats.value.week_total ?? '—' },
  { label: 'P0 待处理', value: stats.value.p0_new ?? '—', accent: true },
  { label: '负面待处理', value: stats.value.negative ?? '—' },
  { label: '宣发素材', value: stats.value.pr_material ?? '—' },
  { label: '待处理总量', value: stats.value.new_total ?? '—' },
])

// 话题雷达 chips（来自热点聚合）
const topicChips = computed(() => (groups.value || []).slice(0, 10))

// ---- 数据 ----
function buildParams() {
  const p = { page: page.value, page_size: 20, q: q.value.trim() || undefined }
  if (market.value) p.market = market.value
  if (scene.value) p.ai_scene = scene.value
  if (platform.value) p.platform = platform.value
  if (activeTopic.value) p.ai_topic = activeTopic.value
  if (tab.value === 'p0') p.ai_priority = 'p0'
  if (tab.value === 'negative') p.ai_sentiment = 'negative'
  if (['feature_opportunity', 'pr_material', 'kol_lead'].includes(tab.value)) p.tags = tab.value
  return p
}

async function load(reset = false) {
  loading.value = true
  try {
    const res = await api.items.list(buildParams())
    const newItems = res.items || []
    items.value = reset ? newItems : [...items.value, ...newItems]
    total.value = res.total ?? newItems.length
    stats.value = res.stats || {}
    emptyContext.value = (!items.value.length && res.empty_context) ? res.empty_context : null
    hasMore.value = items.value.length < total.value
  } finally { loading.value = false }
}

function reload() { page.value = 1; return load(true) }
function loadMore() { page.value++; return load(false) }

async function loadGroups() {
  try {
    const res = await api.items.hot({})
    groups.value = res.groups || []
  } catch { groups.value = [] }
}

// ---- 展示 ----
function painTitle(it) {
  if (it.painpoint) return it.painpoint
  if (it.ai_quote) return it.ai_quote
  return (it.content_text || '').replace(/\s+/g, ' ').slice(0, 24)
}
function engagement(it) {
  const m = it.metrics_json || {}
  return ['like_count', 'liked_count', 'digg_count', 'comment_count', 'repost_count', 'share_count']
    .reduce((s, k) => s + (Number(m[k]) || 0), 0)
}
function timeAgo(it) {
  const t = new Date(it.publish_time || it.created_at || '').getTime()
  if (!t) return ''
  const diff = Date.now() - t
  if (diff < 3600_000) return `${Math.max(1, Math.round(diff / 60_000))} 分钟前`
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)} 小时前`
  if (diff < 30 * 86400_000) return `${Math.round(diff / 86400_000)} 天前`
  return new Date(t).toISOString().slice(0, 10)
}
function statusCls(s) {
  return s === 'new' ? 'bg-slate-100 text-slate-500'
    : s === 'claimed' ? 'bg-amber-100 text-amber-700'
    : s === 'replied' ? 'bg-emerald-100 text-emerald-700'
    : 'bg-slate-50 text-slate-400'
}

// 过滤变化自动重载（搜索单独回车触发）
watch([tab, market, scene, platform], reload)
onMounted(() => { reload(); loadGroups() })
</script>

<style scoped>
.pain-card {
  background: #fff;
  border: 1px solid #eef0f5;
  border-radius: 16px;
  padding: 22px 24px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: box-shadow 0.25s, transform 0.25s, border-color 0.25s;
}
.pain-card:hover {
  box-shadow: 0 10px 30px -12px rgba(79, 70, 229, 0.18);
  border-color: #c7d2fe;
  transform: translateY(-1px);
}
</style>
