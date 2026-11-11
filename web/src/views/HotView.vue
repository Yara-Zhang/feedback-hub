<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-bold text-slate-800">🔥 产品相关热点</h2>
        <p class="text-xs text-slate-400 mt-0.5">沉浸式翻译相关（Part A）近 7 天反馈，按话题聚合、按总热度排序</p>
      </div>
      <select v-model="market" class="input w-32" @change="load">
        <option value="">全部市场</option>
        <option v-for="(m, k) in MARKETS" :key="k" :value="k">{{ m.label }}市场</option>
      </select>
    </div>

    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <div v-else-if="!total && !groups.length" class="card p-10 text-center">
      <div class="text-3xl mb-3">🔍</div>
      <div class="text-slate-600 font-medium mb-1">近 7 天暂无品牌相关反馈</div>
      <div class="text-sm text-slate-400">Part A 数据在抓取后自动进入这里，稍后再来看看</div>
    </div>

    <template v-else>
      <!-- 话题组 -->
      <div v-for="(g, i) in groups" :key="g.topic" class="card mb-4 overflow-hidden">
        <button class="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50" @click="g._open = !g._open">
          <div class="flex items-center gap-3">
            <span class="text-sm font-bold" :class="i === 0 ? 'text-red-600' : 'text-slate-700'">#{{ g.topic }}</span>
            <span class="tag bg-orange-50 text-orange-600">🔥 热度 {{ g.heat }}</span>
            <span class="text-xs text-slate-400">{{ g.count }} 条相关反馈</span>
          </div>
          <span class="text-slate-400 text-xs">{{ g._open ? '收起 ▲' : '展开 ▼' }}</span>
        </button>
        <div v-if="g._open" class="px-5 pb-4 space-y-3">
          <div v-for="it in g.items" :key="it.id" class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 cursor-pointer" @click="goDetail(it.id)">
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-1.5 mb-1">
                <span class="tag" :class="PLATFORMS[it.platform]?.color">{{ PLATFORMS[it.platform]?.label }}</span>
                <span v-if="it.market && it.market !== 'cn'" class="tag" :class="MARKETS[it.market]?.cls">{{ MARKETS[it.market]?.label }}</span>
                <span v-if="it.ai_priority" class="tag" :class="PRIORITIES[it.ai_priority]?.cls">{{ PRIORITIES[it.ai_priority]?.label }}</span>
                <span v-if="it.ai_sentiment === 'negative'" class="tag bg-orange-100 text-orange-600">负面</span>
                <span class="tag" :class="statusCls(it.status)">{{ STATUSES[it.status] }}</span>
              </div>
              <p class="text-sm text-slate-700 line-clamp-2">{{ it.content_text }}</p>
              <div class="flex items-center gap-3 text-xs text-slate-400 mt-1">
                <span v-if="it.heat">热度 {{ it.heat }}</span>
                <span>👤 {{ it.author_name || '匿名' }}</span>
                <span v-if="it.claim_name">已认领：{{ it.claim_name }}</span>
              </div>
            </div>
            <a :href="it.source_url" target="_blank" rel="noopener" class="btn-ghost !px-3 !py-1.5 text-xs shrink-0" @click.stop>查看原文 ↗</a>
          </div>
        </div>
      </div>

      <!-- 其他高互动 -->
      <div v-if="untagged.length" class="card mb-4 overflow-hidden">
        <div class="px-5 py-3.5 flex items-center gap-3 border-b border-slate-100">
          <span class="text-sm font-bold text-slate-700">其他高互动反馈</span>
          <span class="text-xs text-slate-400">未归类到话题，按互动排序</span>
        </div>
        <div class="px-5 pb-4 pt-3 space-y-3">
          <div v-for="it in untagged" :key="it.id" class="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 cursor-pointer" @click="goDetail(it.id)">
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-1.5 mb-1">
                <span class="tag" :class="PLATFORMS[it.platform]?.color">{{ PLATFORMS[it.platform]?.label }}</span>
                <span v-if="it.ai_priority" class="tag" :class="PRIORITIES[it.ai_priority]?.cls">{{ PRIORITIES[it.ai_priority]?.label }}</span>
                <span v-if="it.ai_sentiment === 'negative'" class="tag bg-orange-100 text-orange-600">负面</span>
              </div>
              <p class="text-sm text-slate-700 line-clamp-2">{{ it.content_text }}</p>
              <div class="flex items-center gap-3 text-xs text-slate-400 mt-1">
                <span v-if="it.heat">热度 {{ it.heat }}</span>
                <span>👤 {{ it.author_name || '匿名' }}</span>
              </div>
            </div>
            <a :href="it.source_url" target="_blank" rel="noopener" class="btn-ghost !px-3 !py-1.5 text-xs shrink-0" @click.stop>查看原文 ↗</a>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api'
import { PLATFORMS, PRIORITIES, STATUSES, MARKETS } from '../lib/config'

const router = useRouter()
const groups = ref([])
const untagged = ref([])
const total = ref(0)
const loading = ref(false)
const market = ref('')

async function load() {
  loading.value = true
  try {
    const res = await api.items.hot(market.value ? { market: market.value } : {})
    groups.value = (res.groups || []).map((g) => ({ ...g, _open: false }))
    untagged.value = res.untagged || []
    total.value = res.total || 0
  } catch (e) {
    groups.value = []
  } finally { loading.value = false }
}
function goDetail(id) { router.push(`/item/${id}`) }
function statusCls(s) {
  return {
    new: 'bg-yellow-50 text-yellow-600',
    claimed: 'bg-primary-50 text-primary-700',
    replied: 'bg-green-50 text-green-600',
    skipped: 'bg-slate-100 text-slate-400'
  }[s] || 'bg-slate-100'
}
onMounted(load)
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
