-- ============================================================
-- 反馈工作台 初始化 migration
-- 表结构 + RLS 全禁匿名 + 队列 RPC + 初始关键词种子
-- ============================================================

-- ---------- 用户表 ----------
create table if not exists public.users (
  id bigint generated always as identity primary key,
  feishu_open_id text unique not null,
  name text not null default '同事',
  avatar_url text,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

-- ---------- 关键词表 ----------
-- part_type: part_a(沉浸式翻译相关) / part_b(全量场景) / exclude(排除词)
-- group_tag: comic / novel / video / brand / none
create table if not exists public.keywords (
  id bigint generated always as identity primary key,
  keyword text not null,
  part_type text not null default 'part_b' check (part_type in ('part_a','part_b','exclude')),
  group_tag text not null default 'none',
  enabled boolean not null default true,
  hit_count bigint not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (keyword, part_type)
);

-- ---------- 反馈条目表 ----------
create table if not exists public.feedback_items (
  id bigint generated always as identity primary key,
  part_type text not null check (part_type in ('part_a','part_b')),
  platform text not null check (platform in ('xhs','wb','bili','dy','x')),
  content_type text not null check (content_type in ('video','note','post','comment')),
  source_id text not null,
  source_url text not null,
  author_name text,
  author_id text,
  content_text text not null,
  publish_time text,
  metrics_json jsonb default '{}',
  extra_json jsonb default '{}',
  matched_keywords text[] default '{}',
  -- AI 打标
  ai_priority text check (ai_priority in ('p0','p1','p2')),
  ai_scene text check (ai_scene in ('comic','novel','video','other')),
  ai_sentiment text check (ai_sentiment in ('positive','neutral','negative')),
  ai_tags_json jsonb default '[]',
  ai_reason text,
  ai_status text not null default 'pending' check (ai_status in ('pending','done','skipped')),
  -- 协作
  claim_user_id bigint references public.users(id),
  claim_time timestamptz,
  status text not null default 'new' check (status in ('new','claimed','processed','ignored')),
  dedup_hash text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_items_status on public.feedback_items (status);
create index if not exists idx_items_priority on public.feedback_items (ai_priority);
create index if not exists idx_items_platform on public.feedback_items (platform);
create index if not exists idx_items_scene on public.feedback_items (ai_scene);
create index if not exists idx_items_created on public.feedback_items (created_at desc);
create index if not exists idx_items_claim on public.feedback_items (claim_user_id);

-- ---------- 抓取任务队列 ----------
create table if not exists public.crawl_jobs (
  id bigint generated always as identity primary key,
  job_type text not null check (job_type in ('search','fetch_comments','enrich_llm')),
  platform text check (platform in ('xhs','wb','bili','dy','x')),
  keyword text,
  source_id text,
  source_url text,
  cursor_info jsonb default '{}',
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  retry_count int not null default 0,
  result_note text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_status on public.crawl_jobs (status, id);

-- ---------- 回复草稿 ----------
create table if not exists public.reply_drafts (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.feedback_items(id) on delete cascade,
  draft_type text not null check (draft_type in ('official','passersby')),
  content text not null,
  created_by bigint references public.users(id),
  created_at timestamptz not null default now()
);

-- ---------- 周报记录 ----------
create table if not exists public.weekly_reports (
  id bigint generated always as identity primary key,
  week_start date not null unique,
  stats_json jsonb default '{}',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- 应用配置 ----------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_config (key, value) values
  ('daily_budget', '1500'),
  ('official_accounts', '{}'),   -- platform -> 账号主页 URL / ID，Part A 官号监控用
  ('paused_platforms', '[]'),
  ('last_round_at', 'null')
on conflict (key) do nothing;

-- ---------- 用量表 ----------
create table if not exists public.api_usage (
  id bigint generated always as identity primary key,
  day date not null unique,
  tikhub_calls int not null default 0,
  llm_calls int not null default 0,
  budget_paused boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RLS：全部表对 anon / 普通认证角色关闭直连，只允许 service_role
-- ============================================================
alter table public.users enable row level security;
alter table public.keywords enable row level security;
alter table public.feedback_items enable row level security;
alter table public.crawl_jobs enable row level security;
alter table public.reply_drafts enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.app_config enable row level security;
alter table public.api_usage enable row level security;
-- 不创建任何 policy => anon/authenticated 均无权访问（默认 deny）

-- ============================================================
-- 队列 RPC（用 FOR UPDATE SKIP LOCKED 保证并发安全）
-- ============================================================

-- 取出待执行任务（回收超时 running 任务并标记 running），一次最多 N 个
create or replace function public.pop_jobs(p_limit int default 2)
returns setof public.crawl_jobs
language plpgsql
as $$
begin
  -- 回收超时任务（5 分钟未完成视为死锁，回到队列）
  update public.crawl_jobs
  set status = 'pending', locked_at = null, updated_at = now()
  where status = 'running' and locked_at < now() - interval '5 minutes';

  -- 领取任务（FOR UPDATE SKIP LOCKED 防并发重复领取）
  return query
    update public.crawl_jobs j
    set status = 'running', locked_at = now(), updated_at = now()
    where j.id in (
      select id from public.crawl_jobs
      where status = 'pending'
      order by id
      limit greatest(1, least(p_limit, 10))
      for update skip locked
    )
    returning j.*;
end;
$$;

-- 队列为空时生成新一轮任务（所有启用关键词 × 各平台，Part B 只搜 5 平台）
create or replace function public.enqueue_round()
returns int
language plpgsql
as $$
declare
  v_count int;
  v_budget int;
  v_today date := current_date;
  v_used int;
begin
  select coalesce((value #>> '{}')::int, 1500) into v_budget from public.app_config where key = 'daily_budget';
  select coalesce(tikhub_calls, 0) into v_used from public.api_usage where day = v_today;
  if v_used >= v_budget then
    update public.api_usage set budget_paused = true, updated_at = now() where day = v_today;
    return -1;  -- 预算熔断
  end if;

  select count(*) into v_count
  from public.keywords k
  where k.enabled and k.part_type in ('part_a','part_b')
    and not exists (
      select 1 from public.crawl_jobs j
      where j.job_type = 'search' and j.keyword = k.keyword
        and j.platform is not null and j.created_at > now() - interval '6 hours'
    );

  insert into public.crawl_jobs (job_type, platform, keyword)
  select 'search', p.code, k.keyword
  from public.keywords k
  cross join (values ('xhs'),('wb'),('bili'),('dy'),('x')) as p(code)
  where k.enabled and k.part_type in ('part_a','part_b')
    and not exists (
      select 1 from public.crawl_jobs j
      where j.job_type = 'search' and j.keyword = k.keyword
        and j.platform = p.code and j.created_at > now() - interval '6 hours'
    );

  insert into public.app_config (key, value, updated_at) values ('last_round_at', to_jsonb(now()::text), now())
  on conflict (key) do update set value = to_jsonb(now()::text), updated_at = now();

  return v_count;
end;
$$;

-- 为新增待精筛条目创建 LLM 批处理任务（5 条一批）
create or replace function public.enqueue_llm_jobs()
returns int
language sql
as $$
  with batches as (
    select (row_number() over (order by id) - 1) / 5 as batch_no, id
    from public.feedback_items where ai_status = 'pending'
  )
  insert into public.crawl_jobs (job_type, source_id, result_note)
  select 'enrich_llm', string_agg(id::text, ',' order by id), 'batch'
  from batches
  where batch_no = 0
    and exists (select 1 from public.feedback_items where ai_status = 'pending')
    and not exists (
      select 1 from public.crawl_jobs j where j.job_type = 'enrich_llm' and j.status in ('pending','running')
    )
  returning 1;
$$;

-- ---------- 更新时间戳触发器 ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_items_updated on public.feedback_items;
create trigger trg_items_updated before update on public.feedback_items
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_jobs_updated on public.crawl_jobs;
create trigger trg_jobs_updated before update on public.crawl_jobs
  for each row execute function public.touch_updated_at();

-- ---------- 关键词命中数自增 ----------
create or replace function public.inc_keyword_hits(p_keyword text, p_n int default 1)
returns void
language sql
as $$
  update public.keywords set hit_count = hit_count + p_n where keyword = p_keyword;
$$;

-- ---------- 用量自增 RPC ----------
create or replace function public.inc_usage(p_tikhub int default 0, p_llm int default 0)
returns void
language sql
as $$
  insert into public.api_usage (day, tikhub_calls, llm_calls)
  values (current_date, p_tikhub, p_llm)
  on conflict (day) do update
    set tikhub_calls = public.api_usage.tikhub_calls + p_tikhub,
        llm_calls = public.api_usage.llm_calls + p_llm,
        updated_at = now();
$$;

-- ---------- 工作台统计 RPC ----------
create or replace function public.dashboard_stats()
returns json
language sql
as $$
  select json_build_object(
    'week_total', (select count(*) from public.feedback_items
      where ai_status <> 'skipped' and created_at > now() - interval '7 days'),
    'p0_new', (select count(*) from public.feedback_items
      where ai_priority = 'p0' and status = 'new' and ai_status <> 'skipped'),
    'negative', (select count(*) from public.feedback_items
      where ai_sentiment = 'negative' and status in ('new','claimed') and ai_status <> 'skipped'),
    'pr_material', (select count(*) from public.feedback_items
      where ai_tags_json ? 'pr_material' and status = 'new' and ai_status <> 'skipped'),
    'new_total', (select count(*) from public.feedback_items
      where status = 'new' and ai_status <> 'skipped')
  );
$$;

-- ============================================================
-- 初始关键词种子（可随时在 UI 增删）
-- ============================================================
insert into public.keywords (keyword, part_type, group_tag) values
  -- Part B 漫画
  ('漫画翻译', 'part_b', 'comic'),
  ('日漫翻译', 'part_b', 'comic'),
  ('韩漫翻译', 'part_b', 'comic'),
  ('漫画生肉', 'part_b', 'comic'),
  ('漫画翻译软件', 'part_b', 'comic'),
  ('漫画翻译app', 'part_b', 'comic'),
  ('看漫画翻译', 'part_b', 'comic'),
  ('漫画实时翻译', 'part_b', 'comic'),
  ('漫画机翻', 'part_b', 'comic'),
  -- Part B 小说/AO3
  ('AO3翻译', 'part_b', 'novel'),
  ('ao3怎么翻译', 'part_b', 'novel'),
  ('AO3中文', 'part_b', 'novel'),
  ('ao3机翻', 'part_b', 'novel'),
  ('小说翻译', 'part_b', 'novel'),
  ('网文翻译', 'part_b', 'novel'),
  ('生肉小说', 'part_b', 'novel'),
  ('英文小说翻译', 'part_b', 'novel'),
  ('轻小说翻译', 'part_b', 'novel'),
  ('epub翻译', 'part_b', 'novel'),
  -- Part B 视频
  ('视频翻译', 'part_b', 'video'),
  ('视频字幕翻译', 'part_b', 'video'),
  ('实时字幕翻译', 'part_b', 'video'),
  ('追剧翻译', 'part_b', 'video'),
  ('剧集翻译', 'part_b', 'video'),
  ('油管翻译', 'part_b', 'video'),
  ('YouTube字幕翻译', 'part_b', 'video'),
  ('短视频翻译', 'part_b', 'video'),
  ('直播翻译', 'part_b', 'video'),
  ('弹幕翻译', 'part_b', 'video'),
  ('双语字幕', 'part_b', 'video'),
  ('生肉视频', 'part_b', 'video'),
  -- Part A 沉浸式翻译
  ('沉浸式翻译', 'part_a', 'brand'),
  ('沉浸式翻译app', 'part_a', 'brand'),
  ('沉浸式翻译手机', 'part_a', 'brand'),
  ('沉浸式翻译插件', 'part_a', 'brand'),
  ('immersive translate', 'part_a', 'brand'),
  -- 排除词
  ('翻译兼职', 'exclude', 'none'),
  ('翻译招聘', 'exclude', 'none'),
  ('招翻译', 'exclude', 'none'),
  ('翻译接单', 'exclude', 'none'),
  ('翻译服务', 'exclude', 'none')
on conflict (keyword, part_type) do nothing;

-- ========== 2026-10-29 补丁：函数加 security definer ==========
-- 原因：RLS deny-all 下，service_role 经 PostgREST SET ROLE 调用函数时内部查询看不到行
-- （enrich_llm 任务 source_id 为 NULL 的根因）。加 security definer 后以所有者身份运行，稳定绕过 RLS。
alter function public.pop_jobs(int) security definer set search_path = public;
alter function public.enqueue_round() security definer set search_path = public;
alter function public.enqueue_llm_jobs() security definer set search_path = public;
alter function public.inc_usage(int, int) security definer set search_path = public;
alter function public.inc_keyword_hits(text, int) security definer set search_path = public;
alter function public.dashboard_stats() security definer set search_path = public;

-- ========== 2026-10-29 补丁：关键词别名（圈内黑话） ==========
-- AO3 在简中圈的多种叫法：凹3/凹三/红白；以及同人、汉化场景补充
insert into public.keywords (keyword, part_type, group_tag)
select v.kw, 'part_b', v.grp from (values
  ('凹3翻译', 'novel'), ('凹三翻译', 'novel'), ('红白翻译', 'novel'),
  ('凹3中文', 'novel'), ('ao3双语', 'novel'), ('同人文翻译', 'novel'),
  ('漫画汉化', 'comic')
) as v(kw, grp)
where not exists (select 1 from public.keywords k where k.keyword = v.kw);

-- ========== 2026-10-29 补丁：pop_jobs 打标任务优先出队 ==========
-- 原因：enrich_llm 任务按 id 排序会排在几百个 bulk 搜索任务后面（饿 16 小时+），新抓数据迟迟不打标
create or replace function public.pop_jobs(p_limit int default 2)
returns setof public.crawl_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crawl_jobs
  set status = 'pending', locked_at = null, updated_at = now()
  where status = 'running' and locked_at < now() - interval '5 minutes';

  return query
    update public.crawl_jobs j
    set status = 'running', locked_at = now(), updated_at = now()
    where j.id in (
      select id from public.crawl_jobs
      where status = 'pending'
      order by (case when job_type = 'enrich_llm' then 0 else 1 end), id
      limit greatest(1, least(p_limit, 10))
      for update skip locked
    )
    returning j.*;
end;
$$;
