<template>
  <div>
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-lg font-bold text-slate-800">抓取状态</h2>
      <button class="btn-primary" :disabled="triggering" @click="triggerNow">
        ⚡ 立即抓取一轮
      </button>
    </div>

    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <template v-else>
      <!-- 今日用量 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div class="card p-4">
          <div class="text-xs text-slate-400 mb-1">今日 TikHub 调用</div>
          <div class="text-2xl font-bold" :class="usageOverBudget ? 'text-red-600' : 'text-slate-800'">
            {{ status.today_usage ?? 0 }} <span class="text-sm font-normal text-slate-400">/ {{ status.daily_budget ?? 1500 }}</span>
          </div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-slate-400 mb-1">待处理任务</div>
          <div class="text-2xl font-bold text-primary-600">{{ status.pending_jobs ?? 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-slate-400 mb-1">今日新增反馈</div>
          <div class="text-2xl font-bold text-slate-800">{{ status.today_items ?? 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-slate-400 mb-1">最近一轮抓取</div>
          <div class="text-sm font-bold text-slate-700 pt-1.5">{{ status.last_round || '—' }}</div>
        </div>
      </div>

      <div v-if="usageOverBudget" class="card p-4 mb-5 bg-red-50 border-red-200 text-sm text-red-600">
        ⚠️ 今日调用量已超预算上限，队列已自动暂停，明日恢复。如需继续可在下方调高预算。
      </div>

      <!-- 预算设置 -->
      <div class="card p-4 mb-5 flex items-center gap-3">
        <span class="text-sm text-slate-600">每日调用预算上限：</span>
        <input v-model.number="budgetInput" type="number" class="input w-28" min="100" />
        <button class="btn-ghost" @click="saveBudget">保存</button>
        <span class="text-xs text-slate-400">每次调用约 $0.001-0.004</span>
      </div>

      <!-- 平台暂停状态 -->
      <div class="card p-4 mb-5">
        <h3 class="text-sm font-semibold text-slate-600 mb-3">平台状态</h3>
        <div class="flex flex-wrap gap-2">
          <span v-for="(p, k) in PLATFORMS" :key="k" class="tag"
                :class="isPlatformDown(k) ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'">
            {{ p.icon }} {{ p.label }} {{ isPlatformDown(k) ? '（已暂停：连续失败）' : '正常' }}
          </span>
        </div>
      </div>

      <!-- 任务队列 -->
      <div class="card">
        <h3 class="text-sm font-semibold text-slate-600 p-4 pb-2">最近任务</h3>
        <div class="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          <div v-for="j in status.recent_jobs || []" :key="j.id" class="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span class="tag w-20 justify-center" :class="jobCls(j.status)">{{ JOB_STATUS[j.status] || j.status }}</span>
            <span class="text-slate-500 w-40 truncate">{{ JOB_TYPES[j.job_type] || j.job_type }} · {{ PLATFORMS[j.platform]?.label }}</span>
            <span class="flex-1 text-slate-400 truncate">{{ j.keyword || j.source_id || '' }}</span>
            <span class="text-xs text-slate-300">{{ (j.updated_at || '').slice(5, 16) }}</span>
          </div>
          <div v-if="!(status.recent_jobs || []).length" class="px-4 py-6 text-center text-sm text-slate-300">暂无任务记录</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../lib/api'
import { PLATFORMS } from '../lib/config'

const JOB_TYPES = { search: '关键词搜索', fetch_comments: '评论抓取', enrich_llm: 'AI 精筛' }
const JOB_STATUS = { pending: '排队中', running: '执行中', done: '完成', failed: '失败' }

const status = ref({})
const loading = ref(true)
const triggering = ref(false)
const budgetInput = ref(1500)

const usageOverBudget = computed(() => (status.value.today_usage ?? 0) >= (status.value.daily_budget ?? 1500))
const downPlatforms = computed(() => new Set(status.value.paused_platforms || []))
const isPlatformDown = (k) => downPlatforms.value.has(k)

async function load() {
  loading.value = true
  try {
    status.value = await api.crawl.status()
    budgetInput.value = status.value.daily_budget ?? 1500
  } finally { loading.value = false }
}

async function triggerNow() {
  triggering.value = true
  try {
    await api.crawl.triggerNow()
    alert('已触发新一轮抓取，任务将在几分钟内逐步执行')
    setTimeout(load, 3000)
  } catch (e) { alert(e.message) } finally { triggering.value = false }
}

async function saveBudget() {
  try {
    await api.crawl.setBudget(budgetInput.value)
    alert('预算已保存')
    await load()
  } catch (e) { alert(e.message) }
}

function jobCls(s) {
  return { pending: 'bg-slate-100 text-slate-500', running: 'bg-blue-50 text-blue-600', done: 'bg-green-50 text-green-600', failed: 'bg-red-50 text-red-600' }[s] || 'bg-slate-100'
}

onMounted(load)
</script>
