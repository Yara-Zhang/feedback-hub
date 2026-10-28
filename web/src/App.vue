<template>
  <div class="min-h-screen flex flex-col">
    <!-- 顶栏 -->
    <header v-if="showNav" class="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xl">💬</span>
          <span class="font-bold text-slate-800">翻译场景反馈工作台</span>
        </div>
        <nav class="flex items-center gap-1 text-sm">
          <router-link v-for="n in navs" :key="n.to" :to="n.to"
            class="px-3 py-1.5 rounded-lg hover:bg-slate-100"
            :class="isActive(n.to) ? 'text-primary-700 bg-primary-50 font-medium' : 'text-slate-600'">
            {{ n.label }}
          </router-link>
          <div class="flex items-center gap-2 pl-3 ml-2 border-l border-slate-200">
            <img v-if="user?.avatar_url" :src="user.avatar_url" class="w-7 h-7 rounded-full" alt="" />
            <span class="text-slate-600">{{ user?.name || '同事' }}</span>
            <button @click="logout" class="text-xs text-slate-400 hover:text-red-500">退出</button>
          </div>
        </nav>
      </div>
    </header>

    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
      <router-view />
    </main>

    <footer v-if="showNav" class="py-4 text-center text-xs text-slate-400">
      内部调研工具 · 数据仅供运营参考 · 请勿外传
    </footer>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCachedUser, clearSession } from './lib/api'

const route = useRoute()
const router = useRouter()
const user = getCachedUser()

const navs = computed(() => {
  const list = [
    { to: '/', label: '反馈工作台' },
    { to: '/mine', label: '我的认领' }
  ]
  if (user?.role === 'admin') {
    list.push(
      { to: '/keywords', label: '关键词' },
      { to: '/crawl', label: '抓取状态' },
      { to: '/members', label: '成员' }
    )
  }
  return list
})

const showNav = computed(() => route.name !== 'login')

function isActive(to) { return route.path === to }
function logout() {
  clearSession()
  router.push('/login')
}
</script>
