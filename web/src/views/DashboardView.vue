<template>
  <div>
    <!-- 统计卡 -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
      <div v-for="s in statCards" :key="s.label" class="card p-4">
        <div class="text-xs text-slate-400 mb-1">{{ s.label }}</div>
        <div class="text-2xl font-bold" :class="s.color || 'text-slate-800'">{{ s.value }}</div>
      </div>
    </div>

    <!-- 筛选器 -->
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap gap-2 items-center">
        <select v-model="filters.platform" class="input w-32">
          <option value="">全部平台</option>
          <option v-for="(p, k) in PLATFORMS" :key="k" :value="k">{{ p.label }}</option>
        </select>
        <select v-model="filters.part_type" class="input w-40">
          <option value="">全部来源</option>
          <option value="part_a">沉浸式翻译相关</option>
          <option value="part_b">全量场景</option>
        </select>
        <select v-model="filters.ai_scene" class="input w-32">
          <option value="">全部场景</option>
          <option v-for="(l, k) in SCENES" :key="k" :value="k">{{ l }}</option>
        </select>
        <select v-model="filters.content_type" class="input w-28">
          <option value="">全部类型</option>
          <option v-for="(l, k) in CONTENT_TYPES" :key="k" :value="k">{{ l }}</option>
        </select>
        <select v-model="filters.ai_priority" class="input w-28">
          <option value="">全部优先级</option>
          <option v-for="(p, k) in PRIORITIES" :key="k" :value="k">{{ p.label }} · {{ p.desc }}</option>
        </select>
        <select v-model="filters.status" class="input w-28">
          <option value="">全部状态</option>
          <option v-for="(l, k) in STATUSES" :key="k" :value="k">{{ l }}</option>
        </select>
        <input v-model="filters.q" class="input flex-1 min-w-40" placeholder="搜索反馈内容…" @keyup.enter="reload" />
        <button @click="reload" class="btn-primary">🔍 查询</button>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <div v-else-if="!items.length" class="card p-10 text-center">
      <!-- 情况一：有匹配数据但还在 AI 打标排队 -->
      <template v-if="emptyCtx && emptyCtx.pending_tagging > 0">
        <div class="text-3xl mb-3">⏳</div>
        <div class="text-slate-600 font-medium mb-1">
          有 {{ emptyCtx.pending_tagging }} 条匹配的数据正在排队等待 AI 打标
        </div>
        <div class="text-sm text-slate-400">
          场景 / 优先级筛选要在打标完成后才生效，稍等几分钟刷新即可看到
        </div>
      </template>
      <!-- 情况二：该平台还有抓取任务在队列 -->
      <template v-else-if="emptyCtx && emptyCtx.queued_jobs > 0">
        <div class="text-3xl mb-3">📬</div>
        <div class="text-slate-600 font-medium mb-1">
          还有 {{ emptyCtx.queued_jobs }} 个抓取任务在队列中，数据会陆续进来
        </div>
        <div class="text-sm text-slate-400">
          系统每 5 分钟自动抓一批{{ emptyCtx.last_item_at ? `，最近入库：${formatTime(emptyCtx.last_item_at)}` : '' }}，稍后刷新看看
        </div>
      </template>
      <!-- 情况三：真的没搜到 -->
      <template v-else>
        <div class="text-3xl mb-3">🔍</div>
        <div class="text-slate-600 font-medium mb-1">当前筛选条件下确实没有搜到反馈</div>
        <div class="text-sm text-slate-400">
          可以放宽筛选条件试试；如果这个方向应该有讨论，可到「关键词管理」添加新的搜索关键词
        </div>
      </template>
    </div>
    <div v-else class="space-y-3">
      <FeedbackCard v-for="it in items" :key="it.id" :item="it" @open="goDetail" />
    </div>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="flex items-center justify-center gap-3 mt-6">
      <button class="btn-ghost" :disabled="page <= 1" @click="page--; load()">上一页</button>
      <span class="text-sm text-slate-500">第 {{ page }} / {{ Math.ceil(total / pageSize) }} 页 · 共 {{ total }} 条</span>
      <button class="btn-ghost" :disabled="page >= Math.ceil(total / pageSize)" @click="page++; load()">下一页</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../lib/api'
import { PLATFORMS, CONTENT_TYPES, PART_TYPES, SCENES, PRIORITIES, STATUSES } from '../lib/config'
import FeedbackCard from '../components/FeedbackCard.vue'

const router = useRouter()
const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const stats = ref({})
const emptyCtx = ref(null)

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const filters = reactive({
  platform: '', part_type: '', ai_scene: '', content_type: '', ai_priority: '', status: '', q: ''
})

const statCards = computed(() => [
  { label: '本周新增', value: stats.value.week_total ?? 0, color: 'text-primary-600' },
  { label: 'P0 待处理', value: stats.value.p0_new ?? 0, color: 'text-red-600' },
  { label: '负面口碑', value: stats.value.negative ?? 0, color: 'text-orange-500' },
  { label: '宣发素材候选', value: stats.value.pr_material ?? 0, color: 'text-sky-600' },
  { label: '待认领', value: stats.value.new_total ?? 0 }
])

async function load() {
  loading.value = true
  try {
    const res = await api.items.list({ ...filters, page: page.value, page_size: pageSize })
    items.value = res.items || []
    total.value = res.total || 0
    stats.value = res.stats || {}
    emptyCtx.value = res.empty_context || null
  } catch (e) {
    items.value = []
  } finally { loading.value = false }
}

function reload() { page.value = 1; load() }
function goDetail(id) { router.push(`/item/${id}`) }
onMounted(load)
</script>
