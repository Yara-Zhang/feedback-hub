<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-sky-50">
    <div class="card p-10 w-[420px] text-center">
      <div class="text-4xl mb-3">💬</div>
      <h1 class="text-xl font-bold text-slate-800 mb-1">翻译场景用户反馈工作台</h1>
      <p class="text-sm text-slate-500 mb-6">漫画翻译 · AO3/小说翻译 · 视频翻译</p>

      <!-- 通道切换 -->
      <div class="flex mb-6 bg-slate-100 rounded-lg p-1 text-sm">
        <button class="flex-1 py-2 rounded-md transition"
          :class="mode === 'password' ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500'"
          @click="mode = 'password'">邮箱登录</button>
        <button class="flex-1 py-2 rounded-md transition"
          :class="mode === 'feishu' ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500'"
          @click="mode = 'feishu'">飞书扫码</button>
      </div>

      <!-- 邮箱密码通道 -->
      <div v-if="mode === 'password'" class="text-left">
        <div class="flex mb-4 text-sm">
          <button class="mr-4 pb-1 border-b-2 transition"
            :class="form === 'login' ? 'border-primary-500 text-primary-600 font-medium' : 'border-transparent text-slate-400'"
            @click="form = 'login'">登录</button>
          <button class="pb-1 border-b-2 transition"
            :class="form === 'register' ? 'border-primary-500 text-primary-600 font-medium' : 'border-transparent text-slate-400'"
            @click="form = 'register'">注册新账号</button>
        </div>

        <div class="space-y-3">
          <input v-model="email" type="email" placeholder="邮箱" class="input w-full" @keyup.enter="submit">
          <input v-model="password" type="password" :placeholder="form === 'register' ? '设置密码（至少 6 位）' : '密码'"
            class="input w-full" @keyup.enter="submit">
          <input v-if="form === 'register'" v-model="name" placeholder="昵称（可选，默认取邮箱前缀）" class="input w-full">
          <input v-if="form === 'register'" v-model="inviteCode" placeholder="团队邀请码（向管理员索取）" class="input w-full">
          <button class="btn-primary w-full justify-center py-2.5" :disabled="busy" @click="submit">
            {{ busy ? '请稍候…' : form === 'register' ? '注册并进入' : '登录' }}
          </button>
        </div>
      </div>

      <!-- 飞书扫码通道 -->
      <template v-else>
        <button v-if="!loading" @click="loginFeishu" class="btn-primary w-full justify-center py-3 text-base">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v2H3V3zm0 4h10v2H3V7zm0 4h8v2H3v-2zm14.5 1.5L15 15l2.5 2.5L16 19h6v-6l-1.5 1.5-2.5-2.5-2 2 2-2z"/></svg>
          飞书扫码登录
        </button>
        <p v-else class="text-sm text-slate-400 py-3">跳转飞书授权中…</p>
      </template>

      <p v-if="error" class="mt-4 text-sm text-red-500 bg-red-50 rounded-lg p-3">{{ error }}</p>
      <p class="mt-6 text-xs text-slate-400">仅限团队成员使用 · 登录即代表已获授权</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getFeishuAuthUrl, passwordRegister, passwordLogin, setSession } from '../lib/api'

const route = useRoute()
const router = useRouter()
const mode = ref('password')      // password | feishu
const form = ref('login')         // login | register
const email = ref('')
const password = ref('')
const name = ref('')
const inviteCode = ref('')
const busy = ref(false)
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

async function loginFeishu() {
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

async function submit() {
  busy.value = true
  error.value = ''
  try {
    const res = form.value === 'register'
      ? await passwordRegister({ email: email.value, password: password.value, name: name.value, invite_code: inviteCode.value })
      : await passwordLogin(email.value, password.value)
    setSession(res.token, res.user)
    router.replace('/')
  } catch (e) {
    error.value = e.message || '登录失败，请重试'
  } finally { busy.value = false }
}
</script>
