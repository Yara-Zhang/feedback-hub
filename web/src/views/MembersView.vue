<template>
  <div>
    <h2 class="text-lg font-bold text-slate-800 mb-1">成员管理</h2>
    <p class="text-sm text-slate-400 mb-5">同事首次飞书扫码后会自动出现在这里。管理员可管理关键词与抓取配置。</p>

    <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
    <div v-else class="card divide-y divide-slate-100">
      <div v-for="u in users" :key="u.id" class="flex items-center gap-3 px-4 py-3">
        <img v-if="u.avatar_url" :src="u.avatar_url" class="w-9 h-9 rounded-full" alt="" />
        <div v-else class="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700">{{ (u.name || '?')[0] }}</div>
        <div class="flex-1">
          <div class="text-sm font-medium text-slate-700">{{ u.name }}</div>
          <div class="text-xs text-slate-400">加入于 {{ (u.created_at || '').slice(0, 10) }} · 已处理 {{ u.processed_count ?? 0 }} 条</div>
        </div>
        <span class="tag" :class="u.role === 'admin' ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'">
          {{ u.role === 'admin' ? '管理员' : '成员' }}
        </span>
        <button class="btn-ghost !px-3 !py-1 text-xs" @click="toggleRole(u)">
          {{ u.role === 'admin' ? '设为成员' : '设为管理员' }}
        </button>
      </div>
      <div v-if="!users.length" class="px-4 py-8 text-center text-sm text-slate-300">还没有成员登录过</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { api } from '../lib/api'

const users = ref([])
const loading = ref(true)

async function load() {
  loading.value = true
  try { users.value = (await api.users.list()).users || [] }
  finally { loading.value = false }
}

async function toggleRole(u) {
  try {
    await api.users.setRole(u.id, u.role === 'admin' ? 'member' : 'admin')
    await load()
  } catch (e) { alert(e.message) }
}

onMounted(load)
</script>
