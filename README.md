# 💬 翻译场景用户反馈工作台

多团队协作的在线工具：抓取中文社媒平台（小红书 / 微博 / B站 / 抖音 / X）上关于 **漫画翻译、AO3/小说翻译、视频翻译** 三个手机端内容消费场景的用户反馈，服务于「沉浸式翻译」APP 宣发前的用户调研。

## 功能一览

| 功能 | 说明 |
|---|---|
| 双路抓取 | **Part A** 沉浸式翻译相关（品牌提及帖 + 评论区全覆盖）；**Part B** 三场景全量用户反馈/需求/吐槽 |
| AI 精筛 | DeepSeek 自动判定相关性、场景、情感、**P0/P1/P2 优先级**、运营用途标签（宣发素材/功能机会/负面口碑/KOL线索/竞品提及） |
| 直达原文 | 每条反馈带源页面深链，可验证、可回复 |
| 分类存储 | 视频 / 笔记 / 帖子 / 评论分开打标 |
| 回复草稿 | 一键生成「官方回复」/「路人回复」（仅生成+复制，人工发布） |
| 多人协作 | 飞书扫码登录、认领防冲突、每人独立导出 CSV（Excel 可开） |
| 飞书周报 | 每周一 09:30 自动推送群卡片：新增统计 + P0/P1 重点 + 负面待处理 + 素材候选 |
| 成本护栏 | 每日调用预算熔断、单平台连续失败自动熔断 2 小时并飞书告警 |

## 架构（全免费栈）

```
GitHub 私有仓库（本仓库）
├─ web/                Vue3 + Vite + Tailwind 前端 → GitHub Pages
├─ supabase/
│   ├─ migrations/     Postgres 建表（RLS 全禁匿名直连）
│   └─ functions/      7 个 Edge Functions（Deno）：
│                      feishu-login / crawl-tick / api-items /
│                      api-keywords / api-reply / api-export / weekly-report
├─ .github/workflows/  Pages 自动部署 + 每日保活
└─ TikHub API          统一抓取通道（5 平台搜索+评论）
   DeepSeek API        LLM 精筛与回复草稿
```

## 部署指南（管理员，约 40 分钟）

### 第 0 步：准备账号

| 服务 | 操作 | 得到 |
|---|---|---|
| TikHub | tikhub.io 已有账号 → 用户中心 → API Token → **新建一个专用 Key** | `TIKHUB_API_KEY` |
| Supabase | supabase.com 注册 → New project（区域选 **Southeast Asia**）| `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` |
| DeepSeek | platform.deepseek.com 注册 → 充值 ¥10 | `DEEPSEEK_API_KEY` |
| 飞书应用 | open.feishu.cn → 创建**企业自建应用** | `FEISHU_APP_ID`、`FEISHU_APP_SECRET` |
| 飞书群机器人 | 目标群 → 设置 → 群机器人 → 添加自定义机器人 | `FEISHU_WEBHOOK_URL` |

### 第 1 步：数据库建表

方式 A（推荐）：执行 `node scripts/deploy.mjs sql`（见下方一键部署脚本）
方式 B：Supabase Dashboard → SQL Editor → 粘贴 `supabase/migrations/0001_init.sql` 全文 → Run。

### 第 2 步：部署 Edge Functions（一键脚本，无需本地 Supabase CLI）

```bash
# 1) 复制配置模板并填写（Access Token 在 Account Settings → Access Tokens 生成）
cp scripts/.deploy.env.example scripts/.deploy.env

# 2) 依次执行（或直接 all）
node scripts/deploy.mjs sql        # 建表 + 种子关键词
node scripts/deploy.mjs secrets    # 写入 8 个函数 secrets
node scripts/deploy.mjs functions  # esbuild 打包 7 个函数并经 Management API 部署
node scripts/deploy.mjs cron       # pg_cron 定时任务（crawl-tick 每5分钟 / 周报周一09:30）

# 等价的传统方式（本机已装 Supabase CLI 时）：
# supabase login && supabase secrets set ... && supabase functions deploy <fn> --project-ref <ref>
```

> 脚本通过 Supabase Management API（api.supabase.com）完成全部操作，绕开 CLI 与网络限制；函数先在本地打包为自包含单文件再上传，`_shared` 依赖已内联。

### 第 3 步：配置定时任务

方式 A：`node scripts/deploy.mjs cron`（pg_cron + pg_net + vault，密钥加密存储）
方式 B：Supabase Dashboard → Edge Functions → 选中函数 → Schedules 界面配置：

| 函数 | Cron | 说明 |
|---|---|---|
| `crawl-tick` | `*/5 * * * *` | 每 5 分钟处理 2 个任务分片 |
| `weekly-report` | `30 1 * * 1` | 每周一 09:30（北京时间）发周报 |

### 第 4 步：前端部署到 GitHub Pages

1. 推送本仓库到 GitHub **私有仓库**（名为 `feedback-hub`）
2. 仓库 Settings → Secrets and variables → Actions 添加：
   - `VITE_SUPABASE_URL`（`https://xxx.supabase.co`）
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（供每日保活 workflow 用）
3. Settings → Pages → Source 选 **GitHub Actions**
4. push 到 main 自动构建部署 → 访问 `https://<用户名>.github.io/feedback-hub/`

### 第 5 步：飞书应用配置

open.feishu.cn → 你的自建应用：

1. **安全设置 → 重定向 URL** 添加：`https://<项目ref>.supabase.co/functions/v1/feishu-login/callback`
2. **可用范围**：添加全体使用同事（否则扫码后会报「无权限」）
3. 创建版本并发布

### 第 6 步：验收

- [ ] 打开 Pages 链接 → 飞书扫码 → 看到自己的昵称（**首个登录者自动成为管理员**）
- [ ] 「关键词」页看到 41 个种子关键词
- [ ] 「抓取状态」页点「立即抓取一轮」→ 几分钟内出现带原文链接的反馈
- [ ] 反馈详情页点「生成官方回复」→ 出现可复制草稿
- [ ] 「我的认领」导出 CSV → Excel 打开无乱码
- [ ] 下周一群里收到周报卡片

## 运营使用速查（同事版）

1. **看什么**：工作台默认按时间倒序；P0 = 高价值需尽快处理；「沉浸式翻译」标签 = 与我们产品直接相关
2. **怎么干活**：点「认领」→ 处理（点「查看原文」去原平台回复，可用 AI 草稿）→ 回来标「已处理」
3. **怎么导出**：「我的认领」页 → 一键导出 CSV
4. **关键词调优**（管理员）：抓太多不相关的 → 加排除词；漏了 → 加关键词，6 小时内生效

## 常见问题

| 问题 | 处理 |
|---|---|
| 扫码后报错「无权限」 | 飞书应用「可用范围」没加该同事 |
| 扫码后报错 redirect_uri | 检查重定向 URL 与函数地址完全一致（含 `/callback`） |
| 某平台一直没数据 | 「抓取状态」页看是否熔断（连续失败自动暂停 2h）；TikHub 端点可能需要升级，改 `platforms.ts` 对应路径后重新 deploy |
| 抓取量突然为 0 | 检查「今日 TikHub 调用」是否触顶预算（默认 1500 次/天，可在抓取状态页调） |
| Supabase 项目被暂停 | 免费版 7 天无请求会暂停：检查 GitHub Actions 是否正常、定时任务是否在跑 |

## 成本参考

| 项目 | 费用 |
|---|---|
| GitHub Pages / Actions | 免费（私有仓库每月 2000 Actions 分钟，本项目约 50 分钟） |
| Supabase 免费版 | 免费（500MB 数据库 ≈ 数十万条反馈） |
| TikHub | 按次 ~$0.001-0.004；默认预算 1500 次/天 ≈ $2-6/天满负荷，实际远低 |
| DeepSeek | 约 ¥1-3/百万 tokens，每月几块钱 |

## 已知限制

- **评论级深链**：各平台均不支持定位到具体评论，点击「查看原文」会跳到所属笔记/视频/帖子页，反馈卡片上展示评论文本与作者辅助定位（行业通用做法）
- **官号评论区监控**：v1 通过品牌关键词命中官号帖后自动抓取其评论区实现（官号发帖基本都带产品名）；官号主页轮询列入后续增强
- **AO3 站内**：无公开 API，只抓社媒讨论（微博/X）
- **国内访问**：github.io 与 supabase.co 直连偶发偏慢，后续可绑自定义域名（两者均支持）缓解
