// 各平台适配器：统一 search / fetchComments / 归一化输出
import { dig, firstArray, normTime, stripHtml, tikhubGet } from './client.ts'

export type Platform = 'xhs' | 'wb' | 'bili' | 'dy' | 'x'

export interface NormalItem {
  source_id: string
  source_url: string
  content_type: 'video' | 'note' | 'post' | 'comment'
  author_name?: string
  author_id?: string
  text: string
  publish_time?: string
  metrics: Record<string, number>
  extra: Record<string, unknown>
  comment_count: number
}

export interface PlatformAdapter {
  search(keyword: string, page: number): Promise<NormalItem[]>
  fetchComments(sourceId: string, page: number): Promise<NormalItem[]>
}

function num(v: unknown): number { const n = Number(v); return isNaN(n) ? 0 : n }

// ============ 抖音 ============
const douyin: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/douyin/search/fetch_general_search_v2', {
      keyword, cursor: (page - 1) * 10, count: 10, search_id: '', publish_time: 0, sort_type: 0, filter_duration_type: 0,
    })
    const list = firstArray(res, ['data', 'data'], ['data'])
    return list.map((raw) => {
      const a = (dig(raw, 'aweme_info') ?? raw) as Record<string, unknown>
      const id = String(a.aweme_id ?? dig(a, 'statistics', 'aweme_id') ?? '')
      if (!id) return null
      return {
        source_id: id,
        source_url: `https://www.douyin.com/video/${id}`,
        content_type: 'video',
        author_name: String(dig(a, 'author', 'nickname') ?? ''),
        author_id: String(dig(a, 'author', 'sec_uid') ?? ''),
        text: stripHtml(String(a.desc ?? '')),
        publish_time: normTime(a.create_time),
        metrics: {
          digg_count: num(dig(a, 'statistics', 'digg_count')),
          comment_count: num(dig(a, 'statistics', 'comment_count')),
          share_count: num(dig(a, 'statistics', 'share_count')),
        },
        extra: {},
        comment_count: num(dig(a, 'statistics', 'comment_count')),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    const res = await tikhubGet('/api/v1/douyin/web/fetch_video_comments', {
      aweme_id: sourceId, cursor: (page - 1) * 20, count: 20,
    })
    const list = firstArray(res, ['data', 'data', 'comments'], ['data', 'comments'])
    return list.map((raw) => {
      const c = raw as Record<string, unknown>
      const cid = String(c.cid ?? c.comment_id ?? '')
      if (!cid) return null
      return {
        source_id: `${sourceId}:${cid}`,
        source_url: `https://www.douyin.com/video/${sourceId}`,
        content_type: 'comment',
        author_name: String(dig(c, 'user', 'nickname') ?? ''),
        author_id: String(dig(c, 'user', 'sec_uid') ?? ''),
        text: stripHtml(String(c.text ?? '')),
        publish_time: normTime(c.create_time),
        metrics: { digg_count: num(c.digg_count) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

// ============ 小红书 ============
const xhs: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/xiaohongshu/web/search_notes_v3', {
      keyword, page, page_size: 20, search_id: '', sort: 'general', note_type: 0,
    })
    const list = firstArray(res, ['data', 'data', 'items'], ['data', 'items'], ['data', 'data'])
    return list.map((raw) => {
      const n = (dig(raw, 'note_card') ?? dig(raw, 'note_info') ?? raw) as Record<string, unknown>
      const id = String(n.note_id ?? n.id ?? '')
      if (!id) return null
      const xsec = String(dig(n, 'xsec_token') ?? dig(raw, 'xsec_token') ?? '')
      const title = stripHtml(String(n.title ?? dig(n, 'display_title') ?? ''))
      const desc = stripHtml(String(n.desc ?? ''))
      const text = [title, desc].filter(Boolean).join('\n')
      return {
        source_id: id,
        source_url: `https://www.xiaohongshu.com/explore/${id}${xsec ? `?xsec_token=${xsec}` : ''}`,
        content_type: 'note',
        author_name: String(dig(n, 'user', 'nickname') ?? dig(n, 'user', 'name') ?? ''),
        author_id: String(dig(n, 'user', 'user_id') ?? dig(n, 'user', 'userid') ?? ''),
        text,
        publish_time: normTime(n.time ?? dig(raw, 'time')),
        metrics: {
          liked_count: num(dig(n, 'interact_info', 'liked_count') ?? n.liked_count),
          comment_count: num(dig(n, 'interact_info', 'comment_count') ?? n.comment_count),
        },
        extra: { title },
        comment_count: num(dig(n, 'interact_info', 'comment_count') ?? n.comment_count),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    const res = await tikhubGet('/api/v1/xiaohongshu/app_v2/get_note_comments', {
      note_id: sourceId, cursor: '', index: page - 1, pageArea: 0, sort_strategy: 'latest_v2',
    })
    const list = firstArray(res, ['data', 'data', 'comments'], ['data', 'comments'])
    return list.map((raw) => {
      const c = raw as Record<string, unknown>
      const cid = String(c.id ?? c.comment_id ?? '')
      if (!cid) return null
      return {
        source_id: `${sourceId}:${cid}`,
        source_url: `https://www.xiaohongshu.com/explore/${sourceId}`,
        content_type: 'comment',
        author_name: String(dig(c, 'user_info', 'nickname') ?? ''),
        author_id: String(dig(c, 'user_info', 'user_id') ?? ''),
        text: stripHtml(String(c.content ?? '')),
        publish_time: normTime(c.create_time ?? c.time),
        metrics: { like_count: num(c.like_count ?? dig(c, 'like_counts')) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

// ============ 微博 ============
// ⚠️ 微博评论端点路径需在联调时用 TikHub Swagger(user.tikhub.io) 的 Weibo 分组核对
const weibo: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/weibo/web/fetch_search', {
      q: keyword, page, search_type: 'all',
    })
    const list = firstArray(res, ['data', 'data', 'statuses'], ['data', 'statuses'], ['data', 'data'])
    return list.map((raw) => {
      const s = raw as Record<string, unknown>
      const bid = String(s.bid ?? '')
      const uid = String(dig(s, 'user', 'id') ?? '')
      if (!bid) return null
      return {
        source_id: String(s.idstr ?? s.id ?? bid),
        source_url: `https://weibo.com/${uid}/${bid}`,
        content_type: 'post',
        author_name: String(dig(s, 'user', 'screen_name') ?? ''),
        author_id: uid,
        text: stripHtml(String(s.text ?? s.raw_text ?? '')),
        publish_time: normTime(s.created_at),
        metrics: {
          attitudes_count: num(s.attitudes_count),
          comment_count: num(s.comments_count),
          reposts_count: num(s.reposts_count),
        },
        extra: {},
        comment_count: num(s.comments_count),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    const res = await tikhubGet('/api/v1/weibo/web/fetch_post_comments', {
      id: sourceId, count: 20, page,
    })
    const list = firstArray(res, ['data', 'data', 'comments'], ['data', 'comments'], ['data', 'data', 'data'])
    return list.map((raw) => {
      const c = raw as Record<string, unknown>
      const cid = String(c.id ?? c.mid ?? '')
      if (!cid) return null
      return {
        source_id: `${sourceId}:${cid}`,
        source_url: `https://weibo.com/${dig(c, 'user', 'id') ?? ''}/${sourceId}`,
        content_type: 'comment',
        author_name: String(dig(c, 'user', 'screen_name') ?? ''),
        author_id: String(dig(c, 'user', 'id') ?? ''),
        text: stripHtml(String(c.text ?? c.content ?? '')),
        publish_time: normTime(c.created_at),
        metrics: { like_count: num(c.like_count ?? c.like_counts) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

// ============ B站 ============
const bili: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/bilibili/web/general-search', {
      keyword, page, order: '', duration: '', tids_1: '', tids_2: '',
    })
    const list = firstArray(res, ['data', 'data', 'result'], ['data', 'result'])
    return list.map((raw) => {
      const v = raw as Record<string, unknown>
      if (v.type && v.type !== 'video') return null
      const bvid = String(v.bvid ?? '')
      if (!bvid) return null
      const title = stripHtml(String(v.title ?? ''))
      const desc = stripHtml(String(v.description ?? ''))
      return {
        source_id: bvid,
        source_url: `https://www.bilibili.com/video/${bvid}`,
        content_type: 'video',
        author_name: String(v.author ?? v.name ?? dig(v, 'owner', 'name') ?? ''),
        author_id: String(v.mid ?? dig(v, 'owner', 'mid') ?? ''),
        text: [title, desc].filter(Boolean).join('\n'),
        publish_time: normTime(v.pubdate ?? v.pubdate_ts),
        metrics: {
          view: num(v.play ?? dig(v, 'stat', 'view')),
          like: num(v.like ?? dig(v, 'stat', 'like')),
          comment_count: num(v.video_review ?? v.review ?? dig(v, 'stat', 'reply')),
        },
        extra: { title },
        comment_count: num(v.video_review ?? v.review ?? dig(v, 'stat', 'reply')),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    const res = await tikhubGet('/api/v1/bilibili/web/fetch_video_comments', {
      bv_id: sourceId, pn: page, ps: 20, type: '1', sort: '1',
    })
    const list = firstArray(res, ['data', 'data', 'replies'], ['data', 'replies'])
    return list.map((raw) => {
      const c = raw as Record<string, unknown>
      const rpid = String(c.rpid ?? '')
      if (!rpid) return null
      return {
        source_id: `${sourceId}:${rpid}`,
        source_url: `https://www.bilibili.com/video/${sourceId}`,
        content_type: 'comment',
        author_name: String(dig(c, 'member', 'uname') ?? ''),
        author_id: String(dig(c, 'member', 'mid') ?? ''),
        text: stripHtml(String(dig(c, 'content', 'message') ?? '')),
        publish_time: normTime(c.ctime),
        metrics: { like: num(c.like) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

// ============ X / Twitter ============
const twitter: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/twitter/web/fetch_search_timeline', {
      keyword, search_type: 'Latest', cursor: page > 1 ? `page_${page}` : '', query: '',
    })
    const list = firstArray(res, ['data', 'data', 'tweets'], ['data', 'tweets'], ['data', 'data'])
    return list.map((raw) => {
      const t = raw as Record<string, unknown>
      const id = String(t.id_str ?? t.id ?? dig(t, 'tweet_id') ?? '')
      if (!id) return null
      const screenName = String(dig(t, 'user', 'screen_name') ?? dig(t, 'core', 'user_results', 'result', 'legacy', 'screen_name') ?? '')
      return {
        source_id: id,
        source_url: screenName ? `https://x.com/${screenName}/status/${id}` : `https://x.com/i/status/${id}`,
        content_type: 'post',
        author_name: String(dig(t, 'user', 'name') ?? screenName),
        author_id: screenName,
        text: stripHtml(String(t.full_text ?? t.text ?? dig(t, 'legacy', 'full_text') ?? '')),
        publish_time: normTime(t.created_at ?? dig(t, 'legacy', 'created_at')),
        metrics: {
          like_count: num(t.favorite_count ?? dig(t, 'legacy', 'favorite_count')),
          comment_count: num(t.reply_count ?? dig(t, 'legacy', 'reply_count')),
          repost_count: num(t.retweet_count ?? dig(t, 'legacy', 'retweet_count')),
        },
        extra: {},
        comment_count: num(t.reply_count ?? dig(t, 'legacy', 'reply_count')),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    const res = await tikhubGet('/api/v1/twitter/web/fetch_post_comments', {
      tweet_id: sourceId, cursor: page > 1 ? `page_${page}` : '',
    })
    const list = firstArray(res, ['data', 'data', 'tweets'], ['data', 'tweets'], ['data', 'data', 'comments'])
    return list.map((raw) => {
      const t = raw as Record<string, unknown>
      const id = String(t.id_str ?? t.id ?? '')
      if (!id) return null
      const screenName = String(dig(t, 'user', 'screen_name') ?? '')
      return {
        source_id: `${sourceId}:${id}`,
        source_url: screenName ? `https://x.com/${screenName}/status/${id}` : `https://x.com/i/status/${sourceId}`,
        content_type: 'comment',
        author_name: String(dig(t, 'user', 'name') ?? screenName),
        author_id: screenName,
        text: stripHtml(String(t.full_text ?? t.text ?? '')),
        publish_time: normTime(t.created_at),
        metrics: { like_count: num(t.favorite_count) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

export const adapters: Record<Platform, PlatformAdapter> = { dy: douyin, xhs, wb: weibo, bili, x: twitter }
