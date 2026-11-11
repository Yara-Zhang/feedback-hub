# feedback-hub 2026-11 大升级版 —— 框架思路完整规格

> 自包含文档：描述「沉浸式翻译」用户调研平台（反馈协作工作台 + 痛点雷达洞察层）的完整框架。
> 可直接作为重建依据 / 给 AI 助手的实现指令。栈：GitHub Pages + Supabase（免费版）+ TikHub + DeepSeek + 飞书。

---

## 一、产品定位

「沉浸式翻译」APP 宣发前的**多市场用户需求洞察与响应平台**，双产品形态共享同一数据后台：

1. **痛点雷达 PainRadar**（洞察层）：给运营/决策层看——每条用户反馈用**一句人话痛点标题**直白呈现（对标老板的"机会卡牌"），单列卡片流阅读，话题聚合"N 人同此痛"。
2. **反馈协作工作台**（执行层）：给同事协作处理——认领 → AI 起草回复 → 回帖闭环 → 回复效果复查。

覆盖三场景：**漫画翻译 / AO3·小说翻译 / 视频·字幕翻译**；四市场：**中 / 英 / 日 / 韩**（日/韩阶段 0 只监测、不出回复草稿）；七平台：**小红书 / 微博 / B站 / 抖音 / 知乎 / X / Reddit**（Naver 无接口，留 v2）。

双路采集：
- **Part A**（品牌相关）：命中「沉浸式翻译」品牌词的反馈——口碑、竞品对比、宣发素材
- **Part B**（全量场景）：三场景的泛需求/吐槽/求助——功能机会挖掘

## 二、整体架构（GitHub 免费栈）

```
GitHub Pages（静态前端，Vue3 + Vite + Tailwind，hash 路由）
        │  REST（自签 JWT 会话）
Supabase 免费版
  ├─ Postgres：数据 + pg_cron 定时 + pg_net 出网（数据库内 HTTP）
  ├─ PostgREST：Edge Functions 的数据通道（service key）
  └─ Edge Functions（Deno，8 个）：
       feishu-login   飞书扫码 OAuth 回调 → 签会话
       auth-password  邮箱密码注册/登录（PBKDF2，第二通道）
       crawl-tick     抓取/打标/复查 worker（每 5 分钟一轮）
       api-items      条目列表/详情/认领/状态流转/素材/热点/复查入队
       api-reply      回复草稿（AI 生成 + 人工保存）
       api-export     CSV 导出（个人/全部/宣发 brief/时间范围）
       api-keywords   关键词管理 + 质量统计
       weekly-report  飞书周报/日报/P0 每日汇总告警
外部服务：TikHub（全平台抓取单 Key）· DeepSeek（打标/草稿）· 飞书群 Webhook（通知）
```

出网约束：本地沙箱掐断 `*.supabase.co` 直连——一切验收/运维经数据库 `pg_net`（`net.http_post` + 轮询 `net._http_response`）或 `api.supabase.com` 管理通道执行。

## 三、数据模型（核心表）

**feedback_items**（反馈条目）关键字段：
- 采集：`part_type / platform / content_type / source_id / source_url / author_name / content_text / metrics_json(互动数) / publish_time / dedup_hash(NOT NULL，去重)`
- 市场：`market`（cn/en/jp/kr）
- AI 打标：`ai_status(pending/done/skipped) / ai_priority(p0/p1/p2) / ai_sentiment(正/中/负) / ai_scene(comic/novel/video/other) / ai_tags_json(pr_material/feature_opportunity/negative_pr/kol_lead/competitor) / ai_reason / ai_confidence / ai_quote(≤120字用户卡点原话) / ai_verified(quote 核验布尔) / ai_topic(2-8字话题) / painpoint(≤24字人话痛点标题) / matched_keywords`
- 协作（4 态状态机）：`status(new/claimed/replied/skipped) + claim_user_id / claim_time / reply_url / replied_at / skip_reason`
- 素材：`is_material / material_by / material_at`
- 回复效果：`metrics_after_json / recheck_at`
- 告警：`alarm_flag`（P0 负面高互动命中标记，每日汇总后清零）

**keywords**：`(keyword, part_type, market)` 唯一；四市场种子词 + 外语排除词。
**users**：飞书 open_id 或邮箱密码（`email` 唯一 + `password_hash` PBKDF2）；首用户自动 admin。
**crawl_jobs**：任务队列（`search / fetch_comments / enrich_llm / recheck`）。
**app_config**：运行参数（见 §八参数表）。**weekly_reports / api_usage / reply_drafts**。

## 四、抓取与打标管线

每 5 分钟一轮 `crawl-tick`：
1. `enqueue_round()` 补队列：cn 词×6 平台（6h 去重）/ en 词×(Reddit,X) / jp、kr 词×X（12h 去重）；X 平台按关键词市场拼 `lang:ja|ko` 操作符。
2. `enqueue_llm_jobs()`：把 `ai_status=pending` 条目按 5 条一批入 enrich。
3. `pop_jobs(2)` 出队，**优先级：enrich（打标）> recheck（复查）> search**（防饿死）。
4. 预算熔断：`daily_budget`（TikHub+LLM 合计）超即暂停；单平台连续失败 5 次熔断暂停（enrich/recheck 豁免）。
5. 搜索入库：prefilter 多词 AND 匹配 + 排除词；`detectLang`（假名/谚文占 CJK ≥30% 判 ja/ko）；市场判定优先级：**关键词显式 market > 内容语言 > 平台兜底**；dedup_hash 去重。

**enrich（DeepSeek 打标）输出字段**：relevant / scene / sentiment / priority / tags / quote / confidence / topic / **painpoint**（≤24 字中文大白话，直白写用户遇到的问题，禁技术判定腔） / reason。排除规则（判 false）：①广告/招聘/新闻搬运 ②**发布者是"提供"翻译而非"需要"翻译**（字幕组/汉化组发布"中字/熟肉/翻译：@某某"式成果帖）③成人/敏感。

**卡点原句核验（防 LLM 幻觉摘句）**：`verifyQuote`——squash（去空白/标点/大小写归一）后子串包含→通过；否则三字符滑动片段 ≥60% 命中→通过；空→置 null；长度 <4→false。写回 `ai_verified`；未核验条目 `ai_reason` 加 `[引句未核验]` 前缀只标记不拦截。

**P0 告警（每日汇总制）**：enrich 命中（p0 + negative + 互动 ≥ alarm_threshold）只置 `alarm_flag`；每日北京 10:00 cron 发一张汇总卡后清零（防重复、无打扰）。

## 五、协作状态机与闭环

```
new ──认领(条件更新,防并发)──> claimed ──回填链接──> replied
  ↑                            │                      │
  └────── reopen(清空全部字段) ─┘──填跳过原因──> skipped
```
仅认领人或管理员可流转；jp/kr 条目 generate 草稿被拦截（监测期提示）。回复效果：`/recheck` 把 replied 条目入队，worker 调详情端点抓最新互动写 `metrics_after_json`（抖音详情端点不可用则跳过）。

## 六、通知体系（全部飞书群）

| 通知 | 频率 | 说明 |
|---|---|---|
| 周报 | 周一 09:30 | 总量/平台分布/**市场分布**/P0-P1 清单/负面清单/素材与 KOL 计数 |
| 日报 | 手动按需 | 昨日（北京时间）数据，宣发冲刺期用 |
| P0 汇总 | 每日 10:00 | 红头卡片，发完清 alarm_flag；工作台可手动补发 |

## 七、页面清单

**痛点雷达 `/insights`**（全屏独立，无工作台外壳）：深色品牌顶栏 + 统计带 → 六通道 tab（全部/P0火速/负面口碑/功能机会/宣发素材/KOL线索）+ 市场 pills + 场景/平台/搜索 → 话题雷达 chips（热点聚合，点击聚焦）→ **单列痛点卡片**（P0/市场/平台/情感徽章 → painpoint 大标题 → 原话引用块含核验标 → 摘要 → 话题标签 → 查看原帖 ↗ / 认领处理）+ 加载更多 + 骨架屏 + 空态如实告知"扫描中，N 条待打标"。

**协作工作台**：仪表盘（市场筛选/只看我的认领/认领并起草一键化）、条目详情（直白化状态按钮、AI 区显示置信度/核验/话题/市场、回复后互动对比）、热点（话题分组）、素材库（star 收藏 + 宣发 brief 导出）、我的认领、关键词（市场下拉 + 质量列：命中/相关率/P0，低质词红色高亮）、抓取状态（预算/触发/复查/日报/P0 按钮）、成员管理。

**登录**：双通道——邮箱密码（PBKDF2 10 万次迭代，注册需邀请码，app_config 可改/置空开放）+ 飞书扫码 OAuth。

**导出**：scope mine/all/material（宣发 brief：金句/链接/互动/平台/市场）；range today/this_week/this_month/custom（PostgREST `and=(gte,lt)` 语法）。

## 八、关键参数（默认值）

| 参数 | 默认 | 调参建议 |
|---|---|---|
| daily_budget | 1500 | 视积压调 2500-3000 |
| enrich 批大小 | 5 | 超时多则调 3 |
| alarm_threshold | 50 互动 | 视汇总卡条数校准 |
| crawl-tick | 每 5 分钟×2 任务 | 求快×4（预算翻倍） |
| 注册邀请码 | imt2026 | 置空即开放注册 |

## 九、已踩坑经验（复用价值高）

1. **PostgREST 嵌套歧义（PGRST201）**：一表双外键指向同一表（claim_user_id/material_by→users）时嵌套 select 必须显式外键 `users!feedback_items_claim_user_id_fkey(name)`。
2. **PostgREST schema 缓存**：新加列后 `NOTIFY pgrst,'reload schema'`，生效有延迟，验证失败先重发再等 10s。
3. **PostgREST upsert 部分列 400**：表含 NOT NULL 无默认列（dedup_hash）时 `INSERT..ON CONFLICT` 仍要求该列——批量改值用管理 API 同步执行 `CASE WHEN` 一条 SQL 更新 N 行。
4. **管理 API 限流（429）**：逐条 update×1500 直接触发——批量合并 + 25s 退避重试。
5. **pg_net**：headers 必须是合法 jsonb（shell 转义易错，复杂调用写 .mjs）；GET 之外用 http_post + 轮询 `_http_response`。
6. identity GENERATED ALWAYS 列插显式 id 需 `OVERRIDING SYSTEM VALUE`。
7. TikHub：Reddit sort 枚举必须大写 NEW；抖音详情端点返回空→recheck 跳过。
8. 队列优先级不设好，recheck 会被持续入队的 search 饿死。

## 十、v2 备忘

KOL 线索视图、AI 扩词生命周期、Naver（TikHub 无接口）、官号主页轮询、痛点雷达只读外发版（给决策层）、竞品提及通道。

---

*部署事实：Supabase 项目 migrations 0001-0006 已执行；8 个 Edge Functions ACTIVE；cron 三条（crawl-tick/weekly-report/p0-digest）；前端 GitHub Pages push main 自动构建。存量 painpoint 覆盖率 99%。*
