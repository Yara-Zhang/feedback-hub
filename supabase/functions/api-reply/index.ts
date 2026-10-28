// 回复草稿 API
// GET  /:id/drafts            查看已有草稿
// POST /:id/generate          AI 生成草稿 {draft_type: official|passersby}
// POST /:id/drafts            保存人工修改的草稿 {draft_type, content}
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { restSelect, restInsert, restDelete } from '../_shared/rest.ts'
import { chat } from '../_shared/llm.ts'
import type { SessionPayload } from '../_shared/jwt.ts'

const PLATFORM_NAMES: Record<string, string> = {
  xhs: '小红书', wb: '微博', bili: 'B站', dy: '抖音', x: 'X(推特)',
}

const TYPE_NAMES: Record<string, string> = { video: '视频', note: '笔记', post: '帖子', comment: '评论' }

async function loadItem(id: string): Promise<Record<string, unknown> | null> {
  const { data } = await restSelect<Record<string, unknown>>('feedback_items', {
    select: '*', id: `eq.${id}`,
  }, { single: true })
  return data?.[0] || null
}

async function loadDrafts(id: string) {
  const { data } = await restSelect('reply_drafts', {
    select: '*', item_id: `eq.${id}`, order: 'created_at.desc', limit: 10,
  })
  return data || []
}

// 每类型只保留最近 3 条草稿
async function trimDrafts(itemId: string, draftType: string): Promise<void> {
  const { data } = await restSelect<{ id: number }>('reply_drafts', {
    select: 'id', item_id: `eq.${itemId}`, draft_type: `eq.${draftType}`, order: 'created_at.desc',
  })
  for (const row of (data || []).slice(3)) {
    await restDelete('reply_drafts', { id: `eq.${row.id}` })
  }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path } = fnPath(req, 'api-reply')

  try {
    const session = await requireUser(req)

    // 查看草稿
    const draftsMatch = path.match(/^\/(\d+)\/drafts$/)
    if (draftsMatch && req.method === 'GET') {
      return json({ drafts: await loadDrafts(draftsMatch[1]) })
    }

    // 保存草稿（人工编辑后保存）
    if (draftsMatch && req.method === 'POST') {
      const b = await body<{ draft_type: string; content: string }>(req)
      if (!['official', 'passersby'].includes(b.draft_type)) return err('非法 draft_type')
      if (!b.content?.trim()) return err('内容不能为空')
      await restInsert('reply_drafts', [{
        item_id: Number(draftsMatch[1]), draft_type: b.draft_type,
        content: b.content.trim().slice(0, 1000), created_by: session.sub,
      }])
      await trimDrafts(draftsMatch[1], b.draft_type)
      return json({ ok: true, drafts: await loadDrafts(draftsMatch[1]) })
    }

    // AI 生成草稿
    const genMatch = path.match(/^\/(\d+)\/generate$/)
    if (genMatch && req.method === 'POST') {
      const item = await loadItem(genMatch[1])
      if (!item) return err('反馈不存在', 404)

      const b = await body<{ draft_type: string }>(req)
      if (!['official', 'passersby'].includes(b.draft_type)) return err('非法 draft_type')

      const platform = PLATFORM_NAMES[String(item.platform)] || String(item.platform)
      const scene = String(item.ai_scene || '')
      const isComment = item.content_type === 'comment'
      const parentCtx = isComment ? `（该条为评论，所评论的原文：${(item.extra_json as Record<string, unknown>)?.parent_summary || '无'}）` : ''

      let prompt: string
      if (b.draft_type === 'official') {
        prompt = `你是「沉浸式翻译」的官方运营人员，正在${platform}上回复下面这条用户反馈。要求：
1. 语气友好、真诚、专业，先共情用户的痛点/认可，再自然介绍能解决其问题的功能（根据反馈场景选择：手机端漫画翻译 / AO3网页小说翻译 / 视频双语字幕实时翻译 / 浏览器插件），不确定就泛化介绍；
2. 不要过度营销、不要堆砌感叹号；
3. 长度 100 字以内，符合${platform}评论区的自然语气；
4. 如果反馈是负面吐槽，先道歉承认问题，给出建议方案或说明改进中，不狡辩。

用户反馈内容：
${String(item.content_text).slice(0, 800)}${parentCtx}

直接输出回复正文，不要任何解释或引号。`
      } else {
        prompt = `你是一个${platform}上的普通用户，看到下面这条帖子/评论后，写一条自然的回复。要求：
1. 口语化、像真人随手打的，可以有轻微语气词，第一人称分享自己类似的体验（针对反馈提到的漫画翻译/AO3小说翻译/视频字幕翻译场景）；
2. 你恰好用过「沉浸式翻译」，可以自然地提一句它解决了/能解决这个痛点，但像真心推荐不像广告；
3. 50 字以内，绝不透露任何官方身份；
4. 负面反馈就顺着聊体验，不强行洗白。

帖子/评论内容：
${String(item.content_text).slice(0, 800)}${parentCtx}

直接输出回复正文，不要任何解释或引号。`
      }

      const content = (await chat([{ role: 'user', content: prompt }], { maxTokens: 300 })).trim().replace(/^["「『]|["」』]$/g, '')
      if (!content) return err('生成失败，请重试', 500)

      await restInsert('reply_drafts', [{
        item_id: Number(genMatch[1]), draft_type: b.draft_type,
        content: content.slice(0, 1000), created_by: session.sub,
      }])
      await trimDrafts(genMatch[1], b.draft_type)
      return json({ ok: true, drafts: await loadDrafts(genMatch[1]) })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '鉴权失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '内部错误', 500)
  }
})
