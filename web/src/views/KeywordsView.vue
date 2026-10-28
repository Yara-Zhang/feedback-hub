<template>
  <div>
    <h2 class="text-lg font-bold text-slate-800 mb-1">关键词管理</h2>
    <p class="text-sm text-slate-400 mb-5">关键词决定抓什么。建议小步调整，观察几天「抓取状态」页的命中量再增删。</p>

    <!-- 新增 -->
    <div class="card p-4 mb-4">
      <div class="flex flex-wrap gap-2 items-center">
        <input v-model="form.keyword" class="input flex-1 min-w-48" placeholder="新关键词，如「漫画翻译 app」" @keyup.enter="add" />
        <select v-model="form.part_type" class="input w-44">
          <option value="part_b">全量场景（Part B）</option>
          <option value="part_a">沉浸式翻译相关（Part A）</option>
          <option value="exclude">排除词（命中即丢弃）</option>
        </select>
        <select v-model="form.group_tag" class="input w-32" :disabled="form.part_type === 'exclude'">
          <option value="comic">漫画</option>
          <option value="novel">小说/AO3</option>
          <option value="video">视频</option>
          <option value="brand">品牌</option>
        </select>
        <button class="btn-primary" @click="add" :disabled="!form.keyword.trim()">＋ 添加</button>
      </div>
    </div>

    <!-- 分组列表 -->
    <div v-for="(group, gt) in grouped" :key="gt" class="mb-5">
      <h3 class="text-sm font-semibold text-slate-500 mb-2">
        {{ gt === 'exclude' ? '🚫 排除词' : gt === 'part_a' ? '🔵 沉浸式翻译相关' : '🟢 全量场景' }}
      </h3>
      <div class="card divide-y divide-slate-100">
        <div v-for="row in group" :key="row.id" class="flex items-center gap-3 px-4 py-2.5">
          <span class="tag bg-slate-100 text-slate-500 w-16 justify-center">{{ GROUPS[row.group_tag] || row.group_tag }}</span>
          <span class="flex-1 text-sm text-slate-700">{{ row.keyword }}</span>
          <span class="text-xs text-slate-400">命中 {{ row.hit_count ?? 0 }} 条</span>
          <button class="text-xs px-2 py-1 rounded"
                  :class="row.enabled ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'"
                  @click="toggle(row)">
            {{ row.enabled ? '✅ 启用中' : '已停用' }}
          </button>
          <button class="text-xs text-red-400 hover:text-red-600 px-2 py-1" @click="remove(row)">删除</button>
        </div>
        <div v-if="!group.length" class="px-4 py-3 text-sm text-slate-300">暂无关键词</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../lib/api'

const GROUPS = { comic: '漫画', novel: '小说/AO3', video: '视频', brand: '品牌', none: '—' }
const rows = ref([])
const form = reactive({ keyword: '', part_type: 'part_b', group_tag: 'comic' })

const grouped = computed(() => {
  const g = { part_a: [], part_b: [], exclude: [] }
  for (const r of rows.value) {
    const key = r.part_type
    if (g[key]) g[key].push(r)
  }
  return g
})

async function load() { rows.value = (await api.keywords.list()).keywords || [] }

async function add() {
  if (!form.keyword.trim()) return
  try {
    await api.keywords.create({
      keyword: form.keyword.trim(),
      part_type: form.part_type,
      group_tag: form.part_type === 'exclude' ? 'none' : form.group_tag
    })
    form.keyword = ''
    await load()
  } catch (e) { alert(e.message) }
}

async function toggle(row) {
  try { await api.keywords.update(row.id, { enabled: !row.enabled }); await load() }
  catch (e) { alert(e.message) }
}

async function remove(row) {
  if (!confirm(`确定删除关键词「${row.keyword}」？`)) return
  try { await api.keywords.remove(row.id); await load() }
  catch (e) { alert(e.message) }
}

onMounted(load)
</script>
