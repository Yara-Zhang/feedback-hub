<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-sky-50">
    <div class="card p-10 w-[420px] text-center">
      <div class="text-4xl mb-3">💬</div>
      <h1 class="text-xl font-bold text-slate-800 mb-1">翻译场景用户反馈工作台</h1>
      <p class="text-sm text-slate-500 mb-8">漫画翻译 · AO3/小说翻译 · 视频翻译</p>

      <button v-if="!loading" @click="login" class="btn-primary w-full justify-center py-3 text-base">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v2H3V3zm0 4h10v2H3V7zm0 4h8v2H3v-2zm14.5 1.5L15 15l2.5 2.5L16 19h6v-6l-1.5 1.5-2.5-2.5-2 2 2-2z"/></svg>
        飞书扫码登录
      </button>
      <p v-else class="text-sm text-slate-400 py-3">跳转飞书授权中…</p>

      <p v-if="error" class="mt-4 text-sm text-red-500 bg-red-50 rounded-lg p-3">{{ error }}</p>
      <p class="mt-6 text-xs text-slate-400">仅限团队成员使用 · 登录即代表已获授权</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getFeishuAuthUrl, setSession } from '../lib/api'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  // OAuth 回调：?token=xxx&user=xxx(json)
  const { token, user } = route.query
  if (token && user) {
    try {
      setSession(token, JSON.parse(user))
      router.replace('/')
    } catch { error.value = '登录信息解析失败，请重试' }
    return
  }
  if (route.query.err) error.value = decodeURIComponent(route.query.err)
})

async function login() {
  loading.value = true
  error.value = ''
  try {
    const redirectOrigin = window.location.origin + import.meta.env.BASE_URL
    const { url } = await getFeishuAuthUrl(redirectOrigin)
    window.location.href = url
  } catch (e) {
    error.value = e.message || '无法发起登录，请检查后端配置'
    loading.value = false
  }
}
</script>
