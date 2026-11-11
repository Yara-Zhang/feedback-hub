-- ============================================================
-- 0003: 关键词质量统计 RPC（关键词质量视图用）
-- 每词命中条数 / P0 数 / 相关率（done/(done+skipped)），低质词一键停用的数据依据
-- ============================================================
create or replace function public.keyword_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
    select s.kw as keyword,
      count(*) as hits,
      count(*) filter (where s.ai_priority = 'p0') as p0_count,
      count(*) filter (where s.ai_status = 'skipped') as skipped,
      round(100.0 * count(*) filter (where s.ai_status = 'done') / greatest(count(*), 1), 1) as relevant_rate
    from (
      select unnest(matched_keywords) as kw, ai_priority, ai_status
      from public.feedback_items
    ) s
    group by s.kw
  ) t;
$$;
