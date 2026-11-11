<template>
  <div v-if="loading" class="text-center py-16 text-slate-400">加载中…</div>
  <div v-else-if="!item" class="card p-12 text-center text-slate-400">反馈不存在或已被删除</div>
  <div v-else class="space-y-4">
    <!-- 反馈正文 -->
    <div class="card p-6">
      <div class="flex flex-wrap items-center gap-1.5 mb-4">
        <span class="tag" :class="PLATFORMS[item.platform]?.color">{{ PLATFORMS[item.platform]?.label }} · {{ CONTENT_TYPES[item.content_type] }}</span>
        <span v-if="item.market && item.market !== 'cn'" class="tag" :class="MARKETS[item.market]?.cls">{{ MARKETS[item.market]?.label }}市场</span>
        <span class="tag bg-indigo-50 text-indigo-600" v-if="item.part_type === 'part_a'">沉浸式翻译相关</span>
        <span class="tag bg-slate-100 text-slate-500">{{ PART_TYPES[item.part_type] }}</span>
        <span class="tag" :class="statusCls(item.status)">{{ STATUSES[item.status] }}</span>
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

      <div class="flex flex-wrap gap-2 mt-5 items-center">
        <a :href="item.source_url" target="_blank" rel="noopener" class="btn-primary">
          查看原文（{{ PLATFORMS[item.platform]?.label }}）↗
        </a>
        <button v-if="item.status === 'new'" class="btn-primary" @click="claim">认领这条反馈</button>
        <button v-if="item.status === 'new'" class="btn-primary !bg-slate-700" @click="claimDraft">认领并起草回复</button>
        <template v-if="item.status === 'claimed' && isMine">
          <button class="btn-primary !bg-green-600" @click="markReplied">✅ 标记已回复</button>
          <button class="btn-ghost" @click="markSkipped">跳过</button>
        </template>
        <template v-if="(item.status === 'replied' || item.status === 'skipped') && (isMine || isAdmin)">
          <button class="btn-ghost" @click="reopen">↩ 重新打开</button>
        </template>
        <button class="btn-ghost" :class="item.is_material ? '!text-amber-500' : ''" @click="toggleMaterial">
          {{ item.is_material ? '★ 已收藏素材' : '☆ 收藏为宣发素材' }}
        </button>
        <span v-if="item.claim_name && item.status !== 'new'" class="text-sm text-slate-400 self-center">
          由 {{ item.claim_name }} 认领于 {{ (item.claim_time || '').slice(0, 10) }}
        </span>
      </div>

      <!-- 回复闭环信息 -->
      <div v-if="item.status === 'replied'" class="mt-4 bg-green-50 border border-green-100 rounded-lg p-3 text-sm">
        <b class="text-green-700">已回复</b>
        <span v-if="item.reply_url" class="ml-2">
          <a :href="item.reply_url" target="_blank" rel="noopener" class="text-green-700 underline">{{ item.reply_url }}</a>
        </span>
        <span class="ml-2 text-slate-400">{{ (item.replied_at || '').slice(0, 16).replace('T', ' ') }}</span>
        <template v-if="item.metrics_after_json">
          <span class="ml-4 text-slate-500">
            回复后互动：👍{{ item.metrics_after_json.like_count ?? item.metrics_after_json.liked_count ?? item.metrics_after_json.digg_count ?? 0 }}
            💬{{ item.metrics_after_json.comment_count ?? 0 }}
            <span class="text-xs text-slate-400">（{{ (item.recheck_at || '').slice(0, 10) }} 复查）</span>
          </span>
        </template>
        <template v-else>
          <span class="ml-4 text-xs text-slate-400">复查互动后可看回复效果（管理员在列表页触发复查）</span>
        </template>
      </div>
      <div v-if="item.status === 'skipped' && item.skip_reason" class="mt-4 bg-slate-50 rounded-lg p-3 text-sm text-slate-500">
        <b>跳过原因：</b>{{ item.skip_reason }}
      </div>
    </div>

    <!-- AI 分析 -->
    <div class="card p-6">
      <h3 class="font-bold text-slate-700 mb-3">🤖 AI 分析</h3>
      <template v-if="item.ai_priority">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
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
            <div class="text-xs text-slate-400">话题</div>
            <div class="font-bold text-slate-700 text-sm pt-1">{{ item.ai_topic || '—' }}</div>
          </div>
          <div class="bg-slate-50 rounded-lg p-3 text-center">
            <div class="text-xs text-slate-400">运营用途</div>
            <div class="font-bold text-slate-700 text-xs leading-5 pt-1">{{ (item.ai_tags_json || []).map(t => USE_TAGS[t] || t).join(' / ') || '—' }}</div>
          </div>
        </div>
        <!-- 卡点原话 + 置信度 -->
        <div v-if="item.ai_quote" class="bg-amber-50 border-l-4 border-amber-300 rounded-r-lg p-4 mb-3 text-sm">
          <div class="text-xs text-amber-600 mb-1">用户卡点原话 {{ item.ai_verified === true ? '✓ 已核验' : item.ai_verified === false ? '⚠ 未核验（AI 摘句未在原文中找到，请人工核对）' : '' }}</div>
          <p class="text-slate-700 italic">"{{ item.ai_quote }}"</p>
        </div>
        <div v-if="item.ai_confidence != null" class="text-xs mb-3" :class="item.ai_confidence < 0.7 ? 'text-rose-500' : 'text-slate-400'">
          判定置信度：{{ (item.ai_confidence * 100).toFixed(0) }}%{{ item.ai_confidence < 0.7 ? '（偏低，建议人工复核）' : '' }}
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
        <div class="flex gap-2" v-if="!isMonitorOnly">
          <button class="btn-primary !py-1.5 text-xs" @click="generate('official')" :disabled="generating">生成官方回复</button>
          <button class="btn-ghost !py-1.5 text-xs" @click="generate('passersby')" :disabled="generating">生成路人回复</button>
        </div>
      </div>
      <!-- 日/韩市场监测期提示 -->
      <div v-if="isMonitorOnly" class="bg-slate-50 rounded-lg p-4 text-sm text-slate-500 mb-3">
        🕰 日/韩市场处于监测期，暂不支持生成回复草稿（先积累该市场的需求密度，稳定后开放）
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
      <p v-if="!drafts.length && !isMonitorOnly" class="text-sm text-slate-400">点击上方按钮，AI 将基于反馈内容生成回复草稿（生成后请人工审核再到原平台发布）</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api, getCachedUser } from '../lib/api'
import { PLATFORMS, CONTENT_TYPES, PART_TYPES, SCENES, PRIORITIES, SENTIMENTS, USE_TAGS, STATUSES, MARKETS } from '../lib/config'

const route = useRoute()
const item = ref(null)
const drafts = ref([])
const loading = ref(true)
const generating = ref(false)
const me = getCachedUser()
const isMine = computed(() => item.value?.claim_user_id && me && item.value.claim_user_id === me.id)
const isAdmin = computed(() => me?.role === 'admin')
// 日/韩市场处于监测期：不出草稿
const isMonitorOnly = computed(() => item.value && (item.value.market === 'jp' || item.value.market === 'kr'))

async function load() {
  loading.value = true
  try {
    const d = await api.items.detail(route.params.id)
    item.value = d.item
    drafts.value = d.drafts || []
    // ?draft=official：认领并起草一键链路自动生成
    if (route.query.draft === 'official' && !drafts.value.length && item.value.status === 'claimed' && !isMonitorOnly.value) {
      await generate('official')
    }
  } finally { loading.value = false }
}

async function claim() {
  try {
    await api.items.claim(item.value.id)
    await load()
  } catch (e) { alert(e.message) }
}

// 认领并起草：认领成功后立即生成官方草稿
async function claimDraft() {
  try {
    await api.items.claim(item.value.id)
    await load()
    if (!isMonitorOnly.value) await generate('official')
  } catch (e) { alert(e.message) }
}

async function setStatus(status, extra = {}) {
  try {
    await api.items.setStatus(item.value.id, status, extra)
    await load()
  } catch (e) { alert(e.message) }
}

// 标记已回复：回填回复链接（可选）
async function markReplied() {
  const url = prompt('已在该平台回复？粘贴回复链接（可留空）：', item.value.reply_url || '')
  if (url === null) return // 取消
  await setStatus('replied', { reply_url: (url || '').trim() })
}

// 跳过：写原因（可选）
async function markSkipped() {
  const reason = prompt('跳过原因（可留空）：', '')
  if (reason === null) return
  await setStatus('skipped', { skip_reason: reason })
}

function reopen() { setStatus('new') }

async function toggleMaterial() {
  try {
    await api.items.toggleMaterial(item.value.id)
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

function statusCls(s) {
  return {
    new: 'bg-yellow-50 text-yellow-600',
    claimed: 'bg-primary-50 text-primary-700',
    replied: 'bg-green-50 text-green-600',
    skipped: 'bg-slate-100 text-slate-400'
  }[s] || 'bg-slate-100'
}

onMounted(load)
</script>

<style scoped>
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
