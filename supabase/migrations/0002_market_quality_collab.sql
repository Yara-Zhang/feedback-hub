-- ============================================================
-- 0002: 市场维度 + 判定质量 + 协作闭环 + 宣发增强包
-- 依据：机会卡牌「需求」板块设计参考 + 用户确认范围
-- ============================================================

-- ---------- A. feedback_items 新列 ----------
alter table public.feedback_items
  add column if not exists market text not null default 'cn';
alter table public.feedback_items
  add constraint feedback_items_market_check check (market in ('cn','en','jp','kr'));

-- AI 判定质量字段
alter table public.feedback_items add column if not exists ai_quote text;
alter table public.feedback_items add column if not exists ai_confidence real;
alter table public.feedback_items add column if not exists ai_verified boolean;
alter table public.feedback_items add column if not exists ai_topic text;

-- 协作闭环字段（4 态状态机）
alter table public.feedback_items add column if not exists reply_url varchar(1024);
alter table public.feedback_items add column if not exists replied_at timestamptz;
alter table public.feedback_items add column if not exists skip_reason varchar(300);

-- 宣发素材库字段
alter table public.feedback_items add column if not exists is_material boolean not null default false;
alter table public.feedback_items add column if not exists material_by bigint references public.users(id);
alter table public.feedback_items add column if not exists material_at timestamptz;

-- 回复效果追踪字段
alter table public.feedback_items add column if not exists metrics_after_json jsonb;
alter table public.feedback_items add column if not exists recheck_at timestamptz;

-- ---------- B. 状态机迁移：processed→replied / ignored→skipped ----------
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
    where conrelid = 'public.feedback_items'::regclass and contype = 'c'
      and conname like 'feedback_items_status%';
  if cname is not null then
    execute format('alter table public.feedback_items drop constraint %I', cname);
  end if;
end $$;
update public.feedback_items set status = 'replied' where status = 'processed';
update public.feedback_items set status = 'skipped' where status = 'ignored';
alter table public.feedback_items
  add constraint feedback_items_status_check check (status in ('new','claimed','replied','skipped'));

-- ---------- C. platform CHECK 扩展（reddit / zhihu） ----------
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
    where conrelid = 'public.feedback_items'::regclass and contype = 'c'
      and conname like 'feedback_items_platform%';
  if cname is not null then
    execute format('alter table public.feedback_items drop constraint %I', cname);
  end if;
end $$;
alter table public.feedback_items
  add constraint feedback_items_platform_check check (platform in ('xhs','wb','bili','dy','x','reddit','zhihu'));

-- ---------- D. keywords 加 market 维度 ----------
alter table public.keywords add column if not exists market text not null default 'cn';
alter table public.keywords
  add constraint keywords_market_check check (market in ('cn','en','jp','kr'));

-- 唯一约束替换：(keyword, part_type) -> (keyword, part_type, market)
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
    where conrelid = 'public.keywords'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) like '%keyword%part_type%';
  if cname is not null then
    execute format('alter table public.keywords drop constraint %I', cname);
  end if;
end $$;
alter table public.keywords
  add constraint keywords_kw_pt_market_key unique (keyword, part_type, market);

-- ---------- E. crawl_jobs：platform 扩 + job_type 加 recheck ----------
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
    where conrelid = 'public.crawl_jobs'::regclass and contype = 'c'
      and conname like 'crawl_jobs_platform%';
  if cname is not null then
    execute format('alter table public.crawl_jobs drop constraint %I', cname);
  end if;
end $$;
alter table public.crawl_jobs
  add constraint crawl_jobs_platform_check check (platform in ('xhs','wb','bili','dy','x','reddit','zhihu'));

do $$
declare cname text;
begin
  select conname into cname from pg_constraint
    where conrelid = 'public.crawl_jobs'::regclass and contype = 'c'
      and conname like 'crawl_jobs_job_type%';
  if cname is not null then
    execute format('alter table public.crawl_jobs drop constraint %I', cname);
  end if;
end $$;
alter table public.crawl_jobs
  add constraint crawl_jobs_job_type_check check (job_type in ('search','fetch_comments','enrich_llm','recheck'));

-- ---------- F. 新索引 ----------
create index if not exists idx_items_market on public.feedback_items (market);
create index if not exists idx_items_topic on public.feedback_items (ai_topic, created_at desc) where ai_topic is not null;
create index if not exists idx_items_material on public.feedback_items (material_at desc) where is_material;

-- ---------- G. app_config：告警配置 ----------
insert into public.app_config (key, value) values
  ('alarm_threshold', '50'),
  ('alarm_enabled', 'true')
on conflict (key) do nothing;

-- ============================================================
-- H. enqueue_round 重写：按关键词 market 分派平台
--   cn 词 × (xhs/wb/bili/dy/x/zhihu)，6h 去重（现状 + 知乎）
--   en 词 × (reddit/x)，jp/kr 词 × x，均 12h 去重（控预算）
-- ============================================================
create or replace function public.enqueue_round()
returns int
language plpgsql
security definer
set search_path = public
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

  -- 中文市场：6 平台，6h 去重
  insert into public.crawl_jobs (job_type, platform, keyword)
  select 'search', p.code, k.keyword
  from public.keywords k
  cross join (values ('xhs'),('wb'),('bili'),('dy'),('x'),('zhihu')) as p(code)
  where k.enabled and k.part_type in ('part_a','part_b') and k.market = 'cn'
    and not exists (
      select 1 from public.crawl_jobs j
      where j.job_type = 'search' and j.keyword = k.keyword
        and j.platform = p.code and j.created_at > now() - interval '6 hours'
    );

  -- 外语市场：en -> reddit+x / jp,kr -> x，12h 去重
  insert into public.crawl_jobs (job_type, platform, keyword)
  select 'search', v.plat, k.keyword
  from public.keywords k
  join (values ('en','reddit'),('en','x'),('jp','x'),('kr','x')) as v(mkt, plat)
    on k.market = v.mkt
  where k.enabled and k.part_type in ('part_a','part_b')
    and not exists (
      select 1 from public.crawl_jobs j
      where j.job_type = 'search' and j.keyword = k.keyword
        and j.platform = v.plat and j.created_at > now() - interval '12 hours'
    );

  select count(*) into v_count from public.crawl_jobs where status = 'pending';

  insert into public.app_config (key, value, updated_at) values ('last_round_at', to_jsonb(now()::text), now())
  on conflict (key) do update set value = to_jsonb(now()::text), updated_at = now();

  return v_count;
end;
$$;

-- ============================================================
-- I. 四市场种子关键词（三场景求助式表达）
-- ============================================================
insert into public.keywords (keyword, part_type, group_tag, market)
select v.kw, 'part_b', v.grp, v.mkt from (values
  -- 英文市场 en（Reddit + X）
  ('manga translation app', 'comic', 'en'),
  ('manga translation extension', 'comic', 'en'),
  ('raw manga translate', 'comic', 'en'),
  ('webtoon no english', 'comic', 'en'),
  ('ao3 translate', 'novel', 'en'),
  ('ao3 translation to english', 'novel', 'en'),
  ('fanfic translation tool', 'novel', 'en'),
  ('translate web novel', 'novel', 'en'),
  ('webnovel translation', 'novel', 'en'),
  ('epub translation', 'novel', 'en'),
  ('no english subtitles', 'video', 'en'),
  ('english subtitles missing', 'video', 'en'),
  ('video subtitle translator', 'video', 'en'),
  ('real time subtitle translation', 'video', 'en'),
  ('no english translation', 'video', 'en'),
  -- 日文市场 jp（X + lang:ja）
  ('漫画 翻訳 アプリ', 'comic', 'jp'),
  ('翻訳 ない 漫画', 'comic', 'jp'),
  ('webtoon 日本語 ない', 'comic', 'jp'),
  ('韓国漫画 翻訳', 'comic', 'jp'),
  ('AO3 翻訳', 'novel', 'jp'),
  ('海外小説 翻訳', 'novel', 'jp'),
  ('英語 小説 読めない', 'novel', 'jp'),
  ('小説 翻訳 サイト', 'novel', 'jp'),
  ('英語字幕 読めない', 'video', 'jp'),
  ('日本語字幕 ない', 'video', 'jp'),
  ('字幕なし 動画 翻訳', 'video', 'jp'),
  ('配信 日本語字幕 ない', 'video', 'jp'),
  ('動画 リアルタイム翻訳', 'video', 'jp'),
  -- 韩文市场 kr（X + lang:ko）
  ('웹툰 번역', 'comic', 'kr'),
  ('만화 번역 앱', 'comic', 'kr'),
  ('번역 없는 만화', 'comic', 'kr'),
  ('일본 만화 번역', 'comic', 'kr'),
  ('소설 번역 사이트', 'novel', 'kr'),
  ('영어 소설 번역', 'novel', 'kr'),
  ('해외 소설 번역기', 'novel', 'kr'),
  ('fanfic 번역', 'novel', 'kr'),
  ('한글 자막 없', 'video', 'kr'),
  ('한국어 자막 없', 'video', 'kr'),
  ('자막 없어서 못', 'video', 'kr'),
  ('영상 실시간 번역', 'video', 'kr'),
  ('자막 번역 앱', 'video', 'kr')
) as v(kw, grp, mkt)
on conflict (keyword, part_type, market) do nothing;

-- 外语排除词（招聘类噪声）
insert into public.keywords (keyword, part_type, group_tag, market)
select v.kw, 'exclude', 'none', v.mkt from (values
  ('translation jobs', 'en'),
  ('translator hiring', 'en'),
  ('翻訳者 募集', 'jp'),
  ('翻訳 求人', 'jp'),
  ('번역 알바', 'kr'),
  ('번역 구인', 'kr')
) as v(kw, mkt)
on conflict (keyword, part_type, market) do nothing;
