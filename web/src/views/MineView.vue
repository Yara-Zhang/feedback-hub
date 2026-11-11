<template>
  <div>
    <div class="flex items-center justify-between mb-5 flex-wrap gap-3">
      <h2 class="text-lg font-bold text-slate-800">我的认领与导出</h2>
      <div class="flex flex-wrap gap-2 items-center">
        <!-- 时间范围导出 -->
        <select v-model="exportRange" class="input w-36">
          <option value="">全部时间</option>
          <option value="today">今天</option>
          <option value="this_week">最近 7 天</option>
          <option value="this_month">本月</option>
          <option value="custom">自定义日期</option>
        </select>
        <template v-if="exportRange === 'custom'">
          <input v-model="exportStart" type="date" class="input w-36" />
          <span class="text-slate-400 text-sm">至</span>
          <input v-model="exportEnd" type="date" class="input w-36" />
        </template>
        <a :href="mineExportUrl" class="btn-primary">⬇️ 导出我处理的反馈（Excel/CSV）</a>
        <a v-if="isAdmin" :href="api.exportUrl({ scope: 'all', ...(exportRange ? rangeParams : {}) })" class="btn-ghost">导出全部数据</a>
      </div>
    </div>

    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <div v-else-if="!items.length" class="card p-12 text-center text-slate-400">
      还没有认领反馈，去<a class="text-primary-600" href="/">工作台</a>认领几条吧
    </div>
    <div v-else class="space-y-3">
      <FeedbackCard v-for="it in items" :key="it.id" :item="it"
        @open="goDetail" @claim="noop" @claim-draft="noop" @material="toggleMaterial" />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api, getCachedUser } from '../lib/api'
import FeedbackCard from '../components/FeedbackCard.vue'

const router = useRouter()
const items = ref([])
const loading = ref(true)
const me = getCachedUser()
const isAdmin = computed(() => me?.role === 'admin')

const exportRange = ref('')
const exportStart = ref('')
const exportEnd = ref('')

const rangeParams = computed(() => {
  if (exportRange.value === 'custom') {
    const p = { range: 'custom' }
    if (exportStart.value) p.start = exportStart.value
    if (exportEnd.value) p.end = exportEnd.value
    return p
  }
  return { range: exportRange.value }
})

const mineExportUrl = computed(() => api.exportUrl({ scope: 'mine', ...(exportRange.value ? rangeParams.value : {}) }))

onMounted(async () => {
  try {
    const res = await api.items.list({ status: 'claimed,replied', claim_user_id: 'me', page_size: 100 })
    items.value = res.items || []
  } finally { loading.value = false }
})

function goDetail(id) { router.push(`/item/${id}`) }
function noop() {}
async function toggleMaterial(id) {
  try {
    await api.items.toggleMaterial(id)
    const res = await api.items.list({ status: 'claimed,replied', claim_user_id: 'me', page_size: 100 })
    items.value = res.items || []
  } catch (e) { alert(e.message || '操作失败') }
}
</script>
