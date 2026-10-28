<template>
  <div class="card p-5 hover:shadow-md transition-shadow cursor-pointer" @click="$emit('open', item.id)">
    <div class="flex items-start gap-3">
      <!-- 平台图标 -->
      <div class="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg"
           :class="PLATFORMS[item.platform]?.color || 'bg-slate-100'">
        {{ PLATFORMS[item.platform]?.icon || '?' }}
      </div>

      <div class="flex-1 min-w-0">
        <!-- 标签行 -->
        <div class="flex flex-wrap items-center gap-1.5 mb-1.5">
          <span class="tag" :class="PLATFORMS[item.platform]?.color">{{ PLATFORMS[item.platform]?.label }}</span>
          <span class="tag bg-slate-100 text-slate-600">{{ CONTENT_TYPES[item.content_type] || item.content_type }}</span>
          <span class="tag bg-indigo-50 text-indigo-600" v-if="item.part_type === 'part_a'">沉浸式翻译</span>
          <span class="tag bg-emerald-50 text-emerald-600" v-if="item.ai_scene && SCENES[item.ai_scene]">{{ SCENES[item.ai_scene] }}</span>
          <span v-if="item.ai_priority" class="tag" :class="PRIORITIES[item.ai_priority]?.cls">{{ PRIORITIES[item.ai_priority]?.label }}</span>
          <span v-if="item.ai_sentiment === 'negative'" class="tag bg-orange-100 text-orange-600">负面</span>
          <span v-if="item.ai_sentiment === 'positive'" class="tag bg-green-100 text-green-600">正面</span>
          <span class="tag" :class="statusCls(item.status)">{{ STATUSES[item.status] }}</span>
        </div>

        <!-- 内容摘要 -->
        <p class="text-sm text-slate-700 line-clamp-2 mb-2">{{ item.content_text }}</p>

        <!-- 元信息 -->
        <div class="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <span>👤 {{ item.author_name || '匿名' }}</span>
          <span v-if="fmtTime(item.publish_time)">🕐 {{ fmtTime(item.publish_time) }}</span>
          <span v-if="item.metrics_json?.digg_count != null">👍 {{ item.metrics_json.digg_count }}</span>
          <span v-if="item.metrics_json?.like_count != null">❤️ {{ item.metrics_json.like_count }}</span>
          <span v-if="item.metrics_json?.comment_count != null">💬 {{ item.metrics_json.comment_count }}</span>
          <span v-if="item.claim_name">已认领：{{ item.claim_name }}</span>
        </div>

        <!-- 用途标签 -->
        <div v-if="item.ai_tags_json?.length" class="flex flex-wrap gap-1 mt-2">
          <span v-for="t in item.ai_tags_json" :key="t" class="tag bg-sky-50 text-sky-600">{{ useTagLabel(t) }}</span>
        </div>
      </div>

      <!-- 右侧操作 -->
      <div class="shrink-0 flex flex-col gap-2" @click.stop>
        <a :href="item.source_url" target="_blank" rel="noopener" class="btn-ghost !px-3 !py-1.5 text-xs">查看原文 ↗</a>
        <button v-if="item.status === 'new'" class="btn-primary !px-3 !py-1.5 text-xs" @click="$emit('claim', item.id)">认领</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { PLATFORMS, CONTENT_TYPES, SCENES, PRIORITIES, STATUSES, USE_TAGS } from '../lib/config'

defineProps({ item: { type: Object, required: true } })
defineEmits(['open', 'claim'])

function fmtTime(t) {
  if (!t) return ''
  return String(t).slice(0, 10)
}
function statusCls(s) {
  return { new: 'bg-yellow-50 text-yellow-600', claimed: 'bg-primary-50 text-primary-700', processed: 'bg-green-50 text-green-600', ignored: 'bg-slate-100 text-slate-400' }[s] || 'bg-slate-100'
}
function useTagLabel(t) { return USE_TAGS[t] || t }
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
