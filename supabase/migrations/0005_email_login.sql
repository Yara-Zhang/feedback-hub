-- ========== 0005：邮箱密码登录 ==========
-- 2026-11-11 用户需求：同事们用邮箱密码登录工作台（飞书扫码保留为第二通道）
-- 密码 PBKDF2-SHA256（10 万次迭代 + 16 字节盐）存 users.password_hash（salt:hash base64）

alter table public.users
  add column if not exists email text,
  add column if not exists password_hash text;

-- 邮箱唯一（部分索引，飞书用户 email 为 NULL 不受影响）
create unique index if not exists idx_users_email
  on public.users (email) where email is not null;

-- 注册邀请码：非空时注册必须携带；置空字符串即开放注册（管理员可在 app_config 改）
insert into public.app_config (key, value, updated_at)
values ('invite_code', to_jsonb('imt2026'::text), now())
on conflict (key) do nothing;
