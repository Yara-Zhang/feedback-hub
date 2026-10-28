// 关键词管理 API（仅管理员）
// GET /list | POST / | PATCH /:id | DELETE /:id
import { preflight, json, err, fnPath, body } from '../_shared/cors.ts'
import { requireAdmin } from '../_shared/auth.ts'
import { restSelect, restInsert, restPatch, restDelete } from '../_shared/rest.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const { path, url } = fnPath(req, 'api-keywords')

  try {
    await requireAdmin(req)

    if (path === '/list' && req.method === 'GET') {
      const { data } = await restSelect('keywords', { select: '*', order: 'part_type.asc,id.asc' })
      return json({ keywords: data })
    }

    if ((path === '' || path === '/') && req.method === 'POST') {
      const b = await body<{ keyword: string; part_type: string; group_tag?: string }>(req)
      if (!b.keyword?.trim()) return err('关键词不能为空')
      if (!['part_a', 'part_b', 'exclude'].includes(b.part_type)) return err('非法 part_type')
      try {
        await restInsert('keywords', [{
          keyword: b.keyword.trim().slice(0, 60),
          part_type: b.part_type,
          group_tag: b.group_tag || 'none',
          enabled: true,
        }])
        return json({ ok: true })
      } catch (e) {
        if (String(e).includes('duplicate')) return err('关键词已存在')
        throw e
      }
    }

    const idMatch = path.match(/^\/(\d+)$/)
    if (idMatch && req.method === 'PATCH') {
      const b = await body<{ keyword?: string; enabled?: boolean; group_tag?: string; note?: string }>(req)
      const patch: Record<string, unknown> = {}
      if (typeof b.keyword === 'string' && b.keyword.trim()) patch.keyword = b.keyword.trim().slice(0, 60)
      if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
      if (typeof b.group_tag === 'string') patch.group_tag = b.group_tag
      if (typeof b.note === 'string') patch.note = b.note.slice(0, 200)
      if (!Object.keys(patch).length) return err('无更新字段')
      await restPatch('keywords', { id: `eq.${idMatch[1]}` }, patch)
      return json({ ok: true })
    }

    if (idMatch && req.method === 'DELETE') {
      await restDelete('keywords', { id: `eq.${idMatch[1]}` })
      return json({ ok: true })
    }

    return err('未知路径', 404)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      return err(e instanceof Error ? e.message : '鉴权失败', (e as { status: number }).status)
    }
    return err(e instanceof Error ? e.message : '内部错误', 500)
  }
})
