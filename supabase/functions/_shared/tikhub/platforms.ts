// 各平台适配器：统一 search / fetchComments / 归一化输出
// 端点与字段路径均已对照 TikHub OpenAPI (api.tikhub.io/openapi.json) 及真实响应核对于 2026-10-29
import { dig, firstArray, normTime, stripHtml, tikhubGet, tikhubPost } from './client.ts'

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
// 搜索：POST /douyin/search/fetch_general_search_v2 → data.business_data[type=1].data.aweme_info
// 评论：GET /douyin/app/v3/fetch_video_comments → data.comments[]（web 版端点实测 400，弃用）
const douyin: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubPost('/api/v1/douyin/search/fetch_general_search_v2', {
      keyword, cursor: (page - 1) * 10, sort_type: '0', publish_time: '0',
      filter_duration: '0', content_type: '0', search_id: '', backtrace: '',
    })
    const biz = firstArray(res, ['data', 'business_data'], ['business_data'])
    return biz.map((raw) => {
      const it = raw as Record<string, unknown>
      if (it.type !== 1) return null
      const a = (dig(it, 'data', 'aweme_info') ?? {}) as Record<string, unknown>
      const id = String(a.aweme_id ?? '')
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
    const res = await tikhubGet('/api/v1/douyin/app/v3/fetch_video_comments', {
      aweme_id: sourceId, cursor: (page - 1) * 20, count: 20,
    })
    const list = firstArray(res, ['data', 'comments'], ['data', 'data', 'comments'])
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
// 搜索：GET /xiaohongshu/app_v2/search_notes → data.data.items[].note（note 无 interact_info，liked_count 直取）
// 评论：GET /xiaohongshu/app_v2/get_note_comments → data.data.comments[]（作者字段在 user 而非 user_info）
const xhs: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/xiaohongshu/app_v2/search_notes', {
      keyword, page, sort_type: 'general', note_type: '不限', time_filter: '不限', search_id: '',
    })
    const items = firstArray(res, ['data', 'data', 'items'], ['data', 'items'])
    return items.map((raw) => {
      const n = (dig(raw, 'note') ?? raw) as Record<string, unknown>
      const id = String(n.id ?? n.note_id ?? '')
      if (!id) return null
      const xsec = String(n.xsec_token ?? dig(raw, 'note', 'xsec_token') ?? '')
      const title = stripHtml(String(n.title ?? ''))
      const desc = stripHtml(String(n.desc ?? ''))
      const text = [title, desc].filter(Boolean).join('\n')
      return {
        source_id: id,
        source_url: `https://www.xiaohongshu.com/explore/${id}${xsec ? `?xsec_token=${xsec}` : ''}`,
        content_type: 'note',
        author_name: String(dig(n, 'user', 'nickname') ?? ''),
        author_id: String(dig(n, 'user', 'userid') ?? dig(n, 'user', 'user_id') ?? ''),
        text,
        publish_time: normTime(n.timestamp ?? n.time),
        metrics: {
          liked_count: num(n.liked_count),
          comment_count: num(n.comments_count),
          collected_count: num(n.collected_count),
        },
        extra: { title },
        comment_count: num(n.comments_count),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    const res = await tikhubGet('/api/v1/xiaohongshu/app_v2/get_note_comments', {
      note_id: sourceId, cursor: '', index: page - 1, pageArea: 'UNFOLDED', sort_strategy: 'latest_v2',
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
        author_name: String(dig(c, 'user', 'nickname') ?? dig(c, 'user_info', 'nickname') ?? ''),
        author_id: String(dig(c, 'user', 'userid') ?? dig(c, 'user_info', 'user_id') ?? ''),
        text: stripHtml(String(c.content ?? '')),
        publish_time: normTime(c.time ?? c.create_time),
        metrics: { like_count: num(c.like_count) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

// ============ 微博 ============
// 搜索：GET /weibo/web_v2/fetch_advanced_search → data.parsed_data.results[]（已解析的扁平结构）
// 评论：GET /weibo/web_v2/fetch_post_comments → data.data[]（直接数组，分页靠 max_id，v1 只抓首页）
const weibo: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/weibo/web_v2/fetch_advanced_search', {
      q: keyword, page,
    })
    const list = firstArray(res, ['data', 'parsed_data', 'results'], ['data', 'data', 'statuses'], ['data', 'statuses'])
    return list.map((raw) => {
      const s = raw as Record<string, unknown>
      const weiboId = String(s.weibo_id ?? s.idstr ?? s.id ?? '')
      if (!weiboId) return null
      // post_url 形如 //weibo.com/uid/bid?refer_flag=...，补协议头
      let url = String(s.post_url ?? '')
      if (url.startsWith('//')) url = `https:${url}`
      if (!url && s.bid) url = `https://weibo.com/${dig(s, 'user', 'id') ?? ''}/${s.bid}`
      return {
        source_id: weiboId,
        source_url: url,
        content_type: 'post',
        author_name: String(s.user_name ?? s.user_nick ?? dig(s, 'user', 'screen_name') ?? ''),
        author_id: String(dig(s, 'user', 'id') ?? ''),
        text: stripHtml(String(s.content ?? s.text ?? s.raw_text ?? '')),
        // publish_time 可能是相对时间（"今天09:49"），normTime 会原样保留
        publish_time: normTime(s.publish_time ?? s.created_at),
        metrics: {
          like_count: num(dig(s, 'interaction', 'like_count') ?? s.attitudes_count),
          comment_count: num(dig(s, 'interaction', 'comment_count') ?? s.comments_count),
          repost_count: num(dig(s, 'interaction', 'repost_count') ?? s.reposts_count),
        },
        extra: {},
        comment_count: num(dig(s, 'interaction', 'comment_count') ?? s.comments_count),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    if (page > 1) return [] // web_v2 用 max_id 游标翻页，适配器接口不支持，只抓第一页
    const res = await tikhubGet('/api/v1/weibo/web_v2/fetch_post_comments', {
      id: sourceId, count: 20,
    })
    const list = firstArray(res, ['data', 'data'], ['data', 'data', 'comments'], ['data', 'comments'])
    return list.map((raw) => {
      const c = raw as Record<string, unknown>
      const cid = String(c.rootidstr ?? c.id ?? c.mid ?? '')
      if (!cid) return null
      const uid = String(dig(c, 'user', 'id') ?? dig(c, 'user', 'idstr') ?? '')
      return {
        source_id: `${sourceId}:${cid}`,
        source_url: `https://weibo.com/${uid}/${cid}`,
        content_type: 'comment',
        author_name: String(dig(c, 'user', 'screen_name') ?? ''),
        author_id: uid,
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
// 搜索：GET /bilibili/web/fetch_general_search → data.data.result[]（order/page/page_size 必填）
// 评论：GET /bilibili/web/fetch_video_comments → data.data.replies[]（bv_id + pn，ps/type/sort 均为无效参数已删）
const bili: PlatformAdapter = {
  async search(keyword, page) {
    const res = await tikhubGet('/api/v1/bilibili/web/fetch_general_search', {
      keyword, order: 'totalrank', page, page_size: 20,
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
        author_name: String(v.author ?? v.uname ?? dig(v, 'owner', 'name') ?? ''),
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
      bv_id: sourceId, pn: page,
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
// 搜索：GET /twitter/web/fetch_search_timeline → data.data.timeline[]（扁平：tweet_id/screen_name/favorites）
// 评论：GET /twitter/web/fetch_post_comments → data.thread[]（作者字段在 author）
const twitter: PlatformAdapter = {
  async search(keyword, page) {
    if (page > 1) return [] // 端点无 cursor 参数，仅单页
    const res = await tikhubGet('/api/v1/twitter/web/fetch_search_timeline', {
      keyword, search_type: 'Latest',
    })
    const list = firstArray(res, ['data', 'data', 'timeline'], ['data', 'timeline'], ['data', 'data', 'tweets'])
    return list.map((raw) => {
      const t = raw as Record<string, unknown>
      if (t.type && t.type !== 'tweet') return null
      const id = String(t.tweet_id ?? t.id_str ?? t.id ?? '')
      if (!id) return null
      const screenName = String(dig(t, 'user_info', 'screen_name') ?? t.screen_name ?? dig(t, 'user', 'screen_name') ?? '')
      return {
        source_id: id,
        source_url: screenName ? `https://x.com/${screenName}/status/${id}` : `https://x.com/i/status/${id}`,
        content_type: 'post',
        author_name: String(dig(t, 'user_info', 'name') ?? dig(t, 'user', 'name') ?? screenName),
        author_id: screenName,
        text: stripHtml(String(t.text ?? t.full_text ?? '')),
        publish_time: normTime(t.created_at),
        metrics: {
          like_count: num(t.favorites ?? t.favorite_count),
          comment_count: num(t.replies ?? t.reply_count),
          repost_count: num(t.retweets ?? t.retweet_count),
        },
        extra: { lang: t.lang ?? undefined },
        comment_count: num(t.replies ?? t.reply_count),
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
  async fetchComments(sourceId, page) {
    if (page > 1) return [] // cursor 需从响应链式取值，适配器接口不支持，只抓第一页
    const res = await tikhubGet('/api/v1/twitter/web/fetch_post_comments', {
      tweet_id: sourceId,
    })
    const list = firstArray(res, ['data', 'thread'], ['data', 'data', 'tweets'], ['data', 'data', 'comments'])
    return list.map((raw) => {
      const t = raw as Record<string, unknown>
      const id = String(t.id ?? t.id_str ?? t.tweet_id ?? '')
      if (!id) return null
      const screenName = String(dig(t, 'author', 'screen_name') ?? dig(t, 'user', 'screen_name') ?? '')
      return {
        source_id: `${sourceId}:${id}`,
        source_url: screenName ? `https://x.com/${screenName}/status/${id}` : `https://x.com/i/status/${sourceId}`,
        content_type: 'comment',
        author_name: String(dig(t, 'author', 'name') ?? dig(t, 'user', 'name') ?? screenName),
        author_id: screenName,
        text: stripHtml(String(t.text ?? t.full_text ?? '')),
        publish_time: normTime(t.created_at),
        metrics: { like_count: num(t.likes ?? t.favorite_count) },
        extra: {},
        comment_count: 0,
      } as NormalItem
    }).filter(Boolean) as NormalItem[]
  },
}

export const adapters: Record<Platform, PlatformAdapter> = { dy: douyin, xhs, wb: weibo, bili, x: twitter }
