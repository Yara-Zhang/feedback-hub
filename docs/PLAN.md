# 多平台用户反馈抓取协作工具 — 实施计划

## 项目目标
为「沉浸式翻译」APP 宣发前的用户调研，搭建一个多人协作的在线工具，抓取中文社媒平台上 **漫画翻译 / AO3·小说翻译 / 视频翻译** 三个手机端内容消费场景的用户反馈。

## 核心需求（已与用户确认）
1. **平台**：小红书、微博、B站、抖音 + X/Twitter（只抓简体中文）；Instagram/Threads 不加
2. **两部分数据**：
   - **Part A 沉浸式翻译相关**：官号帖子评论区、KOL 相关内容及评论、用户提及"沉浸式翻译"的帖子/评论
   - **Part B 全量场景反馈**：不限产品，三个场景的所有反馈、需求、吐槽
3. 每条反馈**直达源页面**（内容级深链 100% 可行；评论级各平台均无深链，用「跳转内容页 + 展示评论文本/作者」替代）
4. 视频/笔记/帖子/评论**分类型存储**
5. AI 打标：**P0/P1/P2 优先级** + 运营用途标签（宣发素材/功能机会/负面口碑需处理/KOL线索/竞品提及）
6. 一键生成**官方回复/路人回复**草稿（仅生成+复制，不自动发布）
7. 协作：**飞书扫码登录**、每人独立认领/状态、每人独立导出 CSV/Excel
8. **每周一上午** 飞书群机器人 Webhook 周报
9. UI 清新简洁、按钮化、非技术同事友好

## 技术架构（GitHub 免费栈）

```
GitHub 私有仓库（代码 + CI）
├─ 前端：Vue 3 + Vite + Tailwind CSS → GitHub Pages 静态托管（免费）
├─ 后端：Supabase 免费版
│   ├─ Postgres 数据库（业务数据，仅 Edge Functions 用 service role 访问）
│   ├─ Edge Functions（Deno）：飞书登录/抓取/LLM/列表/导出/周报 全部 API
│   └─ 定时任务（Supabase 内置 cron）：抓取 tick + 周一 09:30 北京时间 周报
├─ 抓取：TikHub API（单一 Key 覆盖 5 平台搜索+详情+评论，~$0.001/次）
└─ LLM：DeepSeek 官方 API（百万 tokens 几元，分类精筛+回复草稿）
```

- 前端 Token 存 localStorage + Authorization Bearer 头（跨域 cookie 不可用，内部工具可接受）
- RLS 全表 deny-all（anon 不可访问），所有数据操作走 Edge Functions
- GitHub Actions：push 自动构建部署 Pages；每日 health-check ping 防 Supabase 免费版 7 天不活跃暂停（抓取 cron 本身也保活）

### 定时调度（解决单次执行时长限制）
Supabase Edge Function 单次有执行时长限制 → **任务分片 + 队列状态机**：
- `crawl-tick` 每 2 分钟触发，每次从 `crawl_jobs` 队列取 1-2 个分片执行（≤60s 工作量）
- 分片粒度：1 个关键词×1 平台×1 页搜索 / 1 条内容×1 页评论 / 5 条待精筛反馈的 LLM 批处理
- `locked_at` 超时 5 分钟自动回收为 pending，超时不丢任务；失败自动重试 ≤3 次
- 支持前端「立即抓取」按钮手动入队

### 关键词两级漏斗（全面但精准）
1. **本地预筛**：标题/正文命中候选词组才入库（砍掉 60-80% 无关内容）
2. **LLM 精筛**：结构化 JSON 输出 `{relevant, scene, sentiment, priority, tags[], reason}`

初始关键词矩阵（存 `keywords` 表，运营可在 UI 增删启停）：
- **Part B 漫画**：漫画翻译、日漫翻译、韩漫翻译、漫画生肉、漫画翻译软件/app、看漫画翻译、漫画实时翻译、漫画机翻
- **Part B 小说/AO3**：AO3翻译、ao3怎么翻译、AO3中文、ao3机翻、小说翻译、网文翻译、生肉小说、英文小说翻译、轻小说翻译、epub翻译、阅读翻译
- **Part B 视频**：视频翻译、视频字幕翻译、实时字幕翻译、追剧翻译、剧集翻译、油管翻译、YouTube字幕翻译、短视频翻译、直播翻译、弹幕翻译、双语字幕、生肉视频
- **Part A**：沉浸式翻译、immersive translate、沉浸式翻译app/插件/手机 + 官号 ID 监控 + 命中帖的评论区抓取
- **排除词**：翻译兼职、翻译招聘、招翻译、翻译接单、翻译服务（商家自荐）等
- X/Twitter 简中过滤：CJK 字符占比 + LLM 判定

## 数据模型（Supabase migrations）
```
users(id, feishu_open_id UNIQUE, name, avatar_url, role admin/member, created_at)
feedback_items(
  id, part_type(part_a/part_b), platform(xhs/wb/bili/dy/x),
  content_type(video/note/post/comment),
  source_id, source_url, author_name, author_id, content_text,
  publish_time, metrics_json(likes/comments/shares), extra_json,
  ai_priority(p0/p1/p2), ai_scene(comic/novel/video/other),
  ai_sentiment, ai_tags_json, ai_reason,
  claim_user_id, status(new/claimed/processed/ignored),
  dedup_hash UNIQUE, created_at, updated_at)
crawl_jobs(id, job_type(search/fetch_comments/enrich_llm), platform,
  keyword, cursor, status(pending/running/done/failed), retry_count,
  locked_at, created_at)
keywords(id, part_type, keyword, group_tag comic/novel/video, enabled, note)
reply_drafts(id, item_id, draft_type(official/passersby), content, created_by, created_at)
weekly_reports(id, week_start, stats_json, sent_at)
```

## TikHub 端点映射（Base `https://api.tikhub.io`，Bearer 认证）
| 平台 | 搜索 | 评论 |
|---|---|---|
| 抖音 | `/api/v1/douyin/search/fetch_general_search_v2` | `/api/v1/douyin/web/fetch_video_comments` |
| 小红书 | `/api/v1/xiaohongshu/web/search_notes_v3` | `/api/v1/xiaohongshu/app_v2/get_note_comments`（需带浏览器 UA；翻页回传 cursor+index+pageArea；sort 用 latest_v2/like_count） |
| 微博 | `/api/v1/weibo/web/fetch_search`（timescope 自定义时间段） | weibo_web_v2 评论端点（实施第 1 天用 TikHub Swagger 核对确切路径） |
| B站 | `/api/v1/bilibili/web/general-search` | `/api/v1/bilibili/web/fetch_video_comments` + comment-reply |
| X | `/api/v1/twitter/web/fetch_search_timeline` | `/api/v1/twitter/web/fetch_post_comments` |

**计费硬性上限**：每关键词每轮最多 2 页搜索、每内容最多 3 页评论、每日调用数落库 + 预算熔断（超阈值自动停队列并飞书告警）；无效 source 提前格式校验（传错 ID 也计费）。

## 深链规则
- 小红书 `xiaohongshu.com/explore/{note_id}`；抖音 `douyin.com/video/{aweme_id}`；B站 `bilibili.com/video/{bv_id}`；微博 `weibo.com/{uid}/{bid}`；X `x.com/{screen_name}/status/{tweet_id}`
- 评论条目：跳转所属内容页 + 卡片上展示评论文本/作者名定位

## 飞书集成
1. **扫码登录**（自建应用，需企业管理员）：open.feishu.cn 创建企业自建应用 → app_id/app_secret → 安全设置配置重定向 URL `https://{ref}.supabase.co/functions/v1/feishu-login` → OAuth 授权码模式后端完成 → 首次登录按 `feishu_open_id` upsert 用户 → 签发 JWT
2. **周报**：飞书群添加自定义机器人获取 Webhook URL（存函数 secret），周一 09:30 北京时间（UTC cron `30 1 * * 1`）发 interactive 卡片：本周新增统计（平台/场景/Part 维度）+ P0/P1 列表（带链接）+ 负面待处理 + 素材候选

## 前端页面（GitHub Pages，清新简洁、大按钮）
1. 登录页（飞书扫码）
2. 反馈工作台：统计卡 + 筛选器（平台/场景/类型/Priority/Part/状态/时间）+ 反馈卡片（内容摘要、平台图标、类型/优先级标签、互动数、**查看原文**按钮、认领按钮、生成回复按钮）
3. 反馈详情：全文、AI 分析（优先级理由/运营用途）、深链、官方/路人回复草稿生成 + 一键复制、状态流转
4. 我的认领 + 导出（CSV/Excel，按 claim_user_id 过滤，exceljs 流式生成）
5. 关键词管理（admin）：关键词组/排除词/官号 ID 增删启停
6. 抓取状态（admin）：队列状态、失败重试、手动「立即抓取」、每日调用量/费用
7. 成员管理（admin）

## 仓库结构
```
repo/
├── web/                      # Vue3+Vite+Tailwind 前端（vite base 配置 /<repo>/）
├── supabase/
│   ├── migrations/           # 建表 SQL（RLS deny-all）
│   └── functions/
│       ├── feishu-login/     # OAuth 发起+回调，签发 JWT
│       ├── crawl-tick/       # 分片调度 worker
│       ├── weekly-report/
│       ├── api-items/        # 列表/详情/认领/状态
│       ├── api-keywords/
│       ├── api-reply/        # 回复草稿生成
│       ├── api-export/       # CSV/Excel 导出
│       └── _shared/          # tikhub 客户端 + 5 平台适配器 + llm + auth
└── .github/workflows/
    ├── deploy-pages.yml      # push → build → GitHub Pages
    └── health-check.yml      # 每日 ping 保活
```

## 实施里程碑
- **M1 地基**：仓库脚手架、Supabase 建表、飞书扫码登录闭环、GitHub Pages 部署链路、环境变量注入（TIKHUB_API_KEY / DEEPSEEK_API_KEY / FEISHU_APP_ID/SECRET / FEISHU_WEBHOOK / JWT_SECRET / SUPABASE_SERVICE_ROLE_KEY）。验收：扫码登录看到昵称，DB 读写连通
- **M2 抓取引擎**：TikHub 客户端 + 5 平台适配器（统一 search/fetchComments/normalize）、关键词管理 UI、crawl_jobs 状态机 + 定时 tick、去重 + 本地预筛。验收：添加 1 个关键词，10 分钟内 feedback_items 出现带 source_url 记录
- **M3 AI + 工作台**：DeepSeek 精筛打标 worker、反馈列表/详情/筛选、认领/状态、回复草稿生成。验收：抓取→打标→认领→生成草稿→复制全动线
- **M4 协作 + 周报**：按人视图、个人导出、周报定时任务、运营一页纸手册。验收：测试群收到首期周报；两人各自导出文件

## 用户侧前置准备（需用户提供/操作）
1. **TikHub**：在已有账号下**单独生成一个专用 API Key** 给本工具（每账号最多 20 个 Key，用量隔离、泄露可单独作废）— 已确认有账号
2. **Supabase**：注册免费账号（可由我引导创建）
3. **DeepSeek**：注册 platform.deepseek.com 并充值少量（¥10 可用很久）
4. **飞书自建应用**：企业管理员在 open.feishu.cn 创建应用，拿 app_id/app_secret，开启网页授权；重定向 URL 部署后回填；可用范围添加全体同事
5. **飞书群机器人**：目标群添加自定义机器人，拿 Webhook URL
6. **GitHub**：用户账号下创建私有仓库（或授权创建）

## 风险与缓解
| 风险 | 缓解 |
|---|---|
| TikHub 上游反爬波动（小红书/微博间歇 403） | 重试回队；单平台连续失败自动暂停并告警；适配层隔离端点便于热切换版本 |
| 计费失控 | 页数硬上限 + 每日预算熔断 + 用量落库对账 |
| Supabase 免费版 7 天不活跃暂停 | 每日抓取 cron + GitHub Actions 每日 ping 保活 |
| github.io / supabase.co 国内直连偶发慢 | 暂无自定义域名，先接受；后续可低成本补域名绑定（两者均支持） |
| 评论无深链 | 产品设计用「跳内容页 + 评论定位」替代（行业通用做法） |
| 搜索排序漂移漏抓 | 「高频浅抓」策略：每轮前 1-2 页 + 时间排序变体，高频轮询优于深翻页 |
| AO3 站内不可抓 | 只抓社媒讨论（微博/X），预期已向用户说明 |
| 多人并发认领冲突 | 条件更新 `UPDATE ... WHERE status='new'`，影响行数=0 则提示已被认领 |
| 飞书应用配置错误（redirect URI/可用范围） | M1 第一天打通登录闭环，附排查清单 |

## 部署方式说明（回应用户疑问）
EdgeOne Makers 已按用户要求替换为 **GitHub 免费栈**：GitHub Pages 只能托管静态前端，因此后端/数据库/定时任务由 Supabase 免费版承担，代码全部托管 GitHub 私有仓库、push 自动部署。全程无腾讯云依赖，免费层政策长期稳定（仅 TikHub 按次费 + DeepSeek 象征性费用）。
