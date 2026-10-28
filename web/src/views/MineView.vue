<template>
  <div>
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-lg font-bold text-slate-800">我的认领与导出</h2>
      <div class="flex gap-2">
        <a :href="api.exportUrl('mine')" class="btn-primary">⬇️ 导出我处理的反馈（Excel/CSV）</a>
        <a v-if="isAdmin" :href="api.exportUrl('all')" class="btn-ghost">导出全部数据</a>
      </div>
    </div>

    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <div v-else-if="!items.length" class="card p-12 text-center text-slate-400">
      还没有认领反馈，去<a class="text-primary-600" href="/">工作台</a>认领几条吧
    </div>
    <div v-else class="space-y-3">
      <FeedbackCard v-for="it in items" :key="it.id" :item="it" @open="goDetail" @claim="noop" />
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

onMounted(async () => {
  try {
    const res = await api.items.list({ status: 'claimed,processed', claim_user_id: 'me', page_size: 100 })
    items.value = res.items || []
  } finally { loading.value = false }
})

function goDetail(id) { router.push(`/item/${id}`) }
function noop() {}
</script>
