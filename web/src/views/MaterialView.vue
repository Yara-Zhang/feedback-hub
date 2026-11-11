<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-bold text-slate-800">⭐ 宣发素材库</h2>
        <p class="text-xs text-slate-400 mt-0.5">收藏的正面素材与用户金句，一键导出宣发 brief（金句/链接/互动数）</p>
      </div>
      <a :href="exportUrl" class="btn-primary text-sm no-underline">📥 导出宣发 brief</a>
    </div>

    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <div v-else-if="!items.length" class="card p-10 text-center">
      <div class="text-3xl mb-3">⭐</div>
      <div class="text-slate-600 font-medium mb-1">还没有收藏任何素材</div>
      <div class="text-sm text-slate-400">
        在反馈工作台的卡片上点「☆ 收藏素材」，把 P0 正面反馈和金句收进来
      </div>
    </div>
    <div v-else class="space-y-3">
      <FeedbackCard v-for="it in items" :key="it.id" :item="it"
        @open="goDetail" @claim="doClaim" @claim-draft="doClaimDraft" @material="toggleMaterial" />
    </div>

    <div v-if="total > pageSize" class="flex items-center justify-center gap-3 mt-6">
      <button class="btn-ghost" :disabled="page <= 1" @click="page--; load()">上一页</button>
      <span class="text-sm text-slate-500">第 {{ page }} / {{ Math.ceil(total / pageSize) }} 页 · 共 {{ total }} 条</span>
      <button class="btn-ghost" :disabled="page >= Math.ceil(total / pageSize)" @click="page++; load()">下一页</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api'
import FeedbackCard from '../components/FeedbackCard.vue'

const router = useRouter()
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const exportUrl = api.exportUrl({ scope: 'material' })

async function load() {
  loading.value = true
  try {
    const res = await api.items.list({
      page: page.value, page_size: pageSize, is_material: '1',
      order: undefined,
    })
    items.value = res.items || []
    total.value = res.total || 0
  } catch (e) {
    items.value = []
  } finally { loading.value = false }
}
function goDetail(id) { router.push(`/item/${id}`) }
async function doClaim(id) {
  try { await api.items.claim(id); await load() } catch (e) { alert(e.message || '认领失败'); load() }
}
async function doClaimDraft(id) {
  try { await api.items.claim(id); router.push(`/item/${id}?draft=official`) } catch (e) { alert(e.message || '认领失败'); load() }
}
async function toggleMaterial(id) {
  try { await api.items.toggleMaterial(id); await load() } catch (e) { alert(e.message || '操作失败') }
}
onMounted(load)
</script>
