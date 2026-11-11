-- ========== 0004：P0 告警改为每日汇总 ==========
-- 2026-11-11 用户反馈：P0 负面反馈不要逐条实时推飞书，每天汇总发一次
-- 机制：enrich 打标命中（p0+negative+互动≥alarm_threshold）时置 alarm_flag=true；
--       /weekly-report/alarm-digest 每日北京时间 10:00（UTC 02:00）统一发送汇总卡后清零

alter table public.feedback_items
  add column if not exists alarm_flag boolean not null default false;

-- 待告警条目稀少，部分索引即可
create index if not exists idx_feedback_items_alarm
  on public.feedback_items (id) where alarm_flag;
