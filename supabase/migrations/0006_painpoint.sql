-- ========== 0006：痛点雷达 painpoint 字段 ==========
-- 2026-11-11 用户需求：每条反馈要"直接写出问题所在"——AI 打标时生成一句人话痛点标题
-- 用于新洞察视图「痛点雷达」的卡片大标题（fallback：ai_quote / 内容前 24 字）

alter table public.feedback_items
  add column if not exists painpoint text;
