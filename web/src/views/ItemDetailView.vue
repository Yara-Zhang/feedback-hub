<template>
  <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
  <div v-else-if="!item" class="card p-12 text-center text-slate-400">反馈不存在或已被删除</div>
  <div v-else class="space-y-4">
    <!-- 反馈正文 -->
    <div class="card p-6">
      <div class="flex flex-wrap items-center gap-1.5 mb-4">
        <span class="tag" :class="PLATFORMS[item.platform]?.color">{{ PLATFORMS[item.platform]?.label }} · {{ CONTENT_TYPES[item.content_type] }}</span>
        <span class="tag bg-indigo-50 text-indigo-600" v-if="item.part_type === 'part_a'">沉浸式翻译相关</span>
        <span class="tag bg-slate-100 text-slate-500">{{ PART_TYPES[item.part_type] }}</span>
      </div>

      <p class="text-slate-800 whitespace-pre-wrap leading-relaxed mb-4">{{ item.content_text }}</p>

      <div class="flex flex-wrap items-center gap-4 text-sm text-slate-500 pb-4 border-b border-slate-100">
        <span>作者：{{ item.author_name || '匿名' }}</span>
        <span v-if="item.publish_time">发布：{{ item.publish_time }}</span>
        <span v-if="item.metrics_json">
          👍{{ item.metrics_json.digg_count ?? item.metrics_json.like_count ?? 0 }}
          💬{{ item.metrics_json.comment_count ?? 0 }}
        </span>
      </div>

      <!-- 评论所属原文 -->
      <div v-if="item.content_type === 'comment' && item.extra_json?.parent_summary" class="mt-4 bg-slate-50 rounded-lg p-3 text-sm">
        <div class="text-xs text-slate-400 mb-1">所评论的原文（{{ item.extra_json.parent_author || '' }}）：</div>
        <p class="text-slate-600 line-clamp-3">{{ item.extra_json.parent_summary }}</p>
      </div>

      <div class="flex flex-wrap gap-2 mt-5">
        <a :href="item.source_url" target="_blank" rel="noopener" class="btn-primary">
          查看原文（{{ PLATFORMS[item.platform]?.label }}）↗
        </a>
        <button v-if="item.status === 'new'" class="btn-primary" @click="claim">认领这条反馈</button>
        <template v-if="item.status === 'claimed' && isMine">
          <button class="btn-ghost" @click="setStatus('processed')">✅ 标记已处理</button>
          <button class="btn-ghost" @click="setStatus('ignored')">忽略</button>
        </template>
        <span v-if="item.claim_name && item.status !== 'new'" class="text-sm text-slate-400 self-center">
          由 {{ item.claim_name }} 认领于 {{ (item.claim_time || '').slice(0, 10) }}
        </span>
      </div>
    </div>

    <!-- AI 分析 -->
    <div class="card p-6">
      <h3 class="font-bold text-slate-700 mb-3">🤖 AI 分析</h3>
      <template v-if="item.ai_priority">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="bg-slate-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-400">优先级</div>
            <div class="font-bold" :class="PRIORITIES[item.ai_priority]?.cls?.includes('red') ? 'text-red-600' : 'text-amber-600'">{{ PRIORITIES[item.ai_priority]?.label }}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-400">场景</div>
            <div class="font-bold text-slate-700">{{ SCENES[item.ai_scene] || item.ai_scene || '—' }}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-400">情感</div>
            <div class="font-bold text-slate-700">{{ SENTIMENTS[item.ai_sentiment] || item.ai_sentiment || '—' }}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-400">运营用途</div>
            <div class="font-bold text-slate-700 text-xs leading-5 pt-1">{{ (item.ai_tags_json || []).map(t => USE_TAGS[t] || t).join(' / ') || '—' }}</div>
          </div>
        </div>
        <div class="bg-slate-50 rounded-lg p-4 text-sm text-slate-600 leading-relaxed">
          <b class="text-slate-700">分析理由：</b>{{ item.ai_reason || '（AI 未给出理由）' }}
        </div>
      </template>
      <p v-else class="text-sm text-slate-400">AI 尚未分析（等待精筛队列处理，通常几分钟内完成）</p>
    </div>

    <!-- 回复草稿 -->
    <div class="card p-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-700">✍️ 回复草稿</h3>
        <div class="flex gap-2">
          <button class="btn-primary !py-1.5 text-xs" @click="generate('official')" :disabled="generating">生成官方回复</button>
          <button class="btn-ghost !py-1.5 text-xs" @click="generate('passersby')" :disabled="generating">生成路人回复</button>
        </div>
      </div>
      <div v-for="d in drafts" :key="d.id" class="bg-slate-50 rounded-lg p-4 mb-3">
        <div class="flex items-center justify-between mb-2">
          <span class="tag" :class="d.draft_type === 'official' ? 'bg-primary-100 text-primary-700' : 'bg-slate-200 text-slate-600'">
            {{ d.draft_type === 'official' ? '官方回复' : '路人回复' }}
          </span>
          <button class="btn-ghost !px-2 !py-1 text-xs" @click="copy(d.content)">📋 复制</button>
        </div>
        <p class="text-sm text-slate-700 whitespace-pre-wrap">{{ d.content }}</p>
      </div>
      <p v-if="!drafts.length" class="text-sm text-slate-400">点击上方按钮，AI 将基于反馈内容生成回复草稿（生成后请人工审核再到原平台发布）</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, getCachedUser } from '../lib/api'
import { PLATFORMS, CONTENT_TYPES, PART_TYPES, SCENES, PRIORITIES, SENTIMENTS, USE_TAGS, STATUSES } from '../lib/config'

const route = useRoute()
const item = ref(null)
const drafts = ref([])
const loading = ref(true)
const generating = ref(false)
const me = getCachedUser()
const isMine = computed(() => item.value?.claim_user_id && me && item.value.claim_user_id === me.id)

async function load() {
  loading.value = true
  try {
    const d = await api.items.detail(route.params.id)
    item.value = d.item
    drafts.value = d.drafts || []
  } finally { loading.value = false }
}

async function claim() {
  try {
    await api.items.claim(item.value.id)
    await load()
  } catch (e) { alert(e.message) }
}

async function setStatus(status) {
  try {
    await api.items.setStatus(item.value.id, status)
    await load()
  } catch (e) { alert(e.message) }
}

async function generate(type) {
  generating.value = true
  try {
    await api.items.generateDraft(item.value.id, type)
    const d = await api.items.drafts(item.value.id)
    drafts.value = d.drafts || []
  } catch (e) { alert(e.message) } finally { generating.value = false }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); alert('已复制到剪贴板') }
  catch { alert('复制失败，请手动选择文本复制') }
}

onMounted(load)
</script>
