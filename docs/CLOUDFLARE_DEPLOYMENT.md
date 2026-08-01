# Cloudflare 开源演示站部署

该部署方式与现有 Node.js + SQLite 方式并存，不改变路线推荐核心：

- Worker 运行 Server API，并将非 API 请求交给静态资源绑定。
- 静态资源直接由 Cloudflare 边缘缓存提供，只有 API 与高德安全代理进入 Worker。
- D1 保存匿名会话、收藏路线和现场反馈。
- R2 缓存已处理的 ESA WorldCover 栅格，不保存高德 Key。
- 高德 Web 服务 Key、JS Key、安全密钥和会话签名密钥均使用 Worker Secrets。

## 1. 前置条件

需要 Node.js 22、pnpm、Cloudflare 账号，以及已经在高德控制台完成域名白名单配置的 Key。聊天、截图或历史提交中暴露过的 Key 必须先在高德控制台轮换。

```bash
pnpm install --frozen-lockfile
pnpm dlx wrangler@4.114.0 login
```

## 2. 创建 D1 和 R2

```bash
pnpm dlx wrangler@4.114.0 d1 create zhaolu-route-finder
pnpm dlx wrangler@4.114.0 r2 bucket create zhaolu-scenery-cache
```

把 D1 创建命令返回的 `database_id` 写入 `wrangler.jsonc`，替换 `replace-with-d1-database-id`。资源 ID 不是密钥，但不要把任何真实高德 Key 写入该文件。

## 3. 配置公开信息和 Secrets

先在 `wrangler.jsonc` 中把 `CHANGE_ME` 替换为实际运营者名称和隐私联系地址。随后逐个写入密钥：

```bash
pnpm dlx wrangler@4.114.0 secret put AMAP_WEB_SERVICE_KEY
pnpm dlx wrangler@4.114.0 secret put AMAP_WEB_JS_KEY
pnpm dlx wrangler@4.114.0 secret put AMAP_JS_SECURITY_CODE
pnpm dlx wrangler@4.114.0 secret put ZHAOLU_SESSION_SECRET
```

`ZHAOLU_SESSION_SECRET` 至少 32 个随机字符。高德 JS Key 是浏览器端公开标识，但仍通过 Secret 管理，避免开发者误把整套配置复制进仓库；真正必须保密的是 Web 服务 Key 和安全密钥。

## 4. 迁移和部署

```bash
pnpm run cloudflare:migrate:remote
pnpm run cloudflare:deploy
```

部署后验证：

```text
GET /api/v1/health/live
GET /api/v1/health/ready
GET /api/v1/config
POST /api/v1/routes/plan
```

最后在高德控制台将 Web JS Key 的域名白名单更新为实际 `workers.dev` 或自定义域名，并验证卫星图、路线规划、收藏与删除数据。

## 本地 Worker 验证

复制 `.dev.vars.example` 为 `.dev.vars`，只在未跟踪的 `.dev.vars` 中填写测试密钥：

```bash
pnpm run cloudflare:migrate:local
pnpm run cloudflare:dev
```

## GitHub Actions 自动部署

仓库工作流使用以下 GitHub Actions Secrets：

- `CLOUDFLARE_API_TOKEN`：仅授予目标账号的 Workers Scripts、D1 和 R2 所需权限。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID。

高德 Key 和 `ZHAOLU_SESSION_SECRET` 由 `wrangler secret put` 直接保存在 Cloudflare；不要把它们写入 GitHub Actions 日志。自动化发布前仍需先手动创建 D1/R2，并把真实 D1 资源 ID 写入部署配置。

## 免费额度与生产边界

R2 缓存命中可减少 WorldCover 重复计算，但首次分析仍要读取远端 COG。Workers Free 的 CPU 上限可能不足以稳定处理完整多候选路线；演示阶段先测真实请求，如果出现 CPU 超限，应升级 Workers Paid 或把环境分析拆成队列/预计算任务。中国大陆稳定访问还涉及单独的 Cloudflare China Network 与 ICP 要求，普通 `workers.dev` 不等同于大陆部署。
