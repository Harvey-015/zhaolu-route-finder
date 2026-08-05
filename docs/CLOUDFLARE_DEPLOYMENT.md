# Cloudflare 开源演示站部署

该部署方式与现有 Node.js + SQLite 方式并存，不改变路线推荐核心：

- Worker 运行 Server API，并将非 API 请求交给静态资源绑定。
- 静态资源直接由 Cloudflare 边缘缓存提供，只有 API 与高德安全代理进入 Worker。
- D1 保存匿名会话、收藏路线和现场反馈。
- 默认零费用方案不订阅 R2，WorldCover 使用请求内与 Worker 实例内缓存。
- 未来需要跨实例缓存时，可选接入 R2，不改变推荐算法或环境数据端口。
- 高德 Web 服务 Key、JS Key、安全密钥和会话签名密钥均使用 Worker Secrets。

## 1. 前置条件

需要 Node.js 22、pnpm、Cloudflare 账号，以及已经在高德控制台完成域名白名单配置的 Key。聊天、截图或历史提交中暴露过的 Key 必须先在高德控制台轮换。

```bash
pnpm install --frozen-lockfile
pnpm dlx wrangler@4.118.0 login
```

## 2. 创建 D1

```bash
pnpm dlx wrangler@4.118.0 d1 create zhaolu-route-finder
```

把 D1 创建命令返回的 `database_id` 写入 `wrangler.jsonc`。资源 ID 不是密钥，但不要把任何真实高德 Key 写入该文件。

## 3. 配置公开信息和 Secrets

`wrangler.jsonc` 默认使用项目维护者名称和公开 GitHub Issues 地址；实际运营主体不同的部署应先替换这两项公开信息。随后逐个写入密钥：

```bash
pnpm dlx wrangler@4.118.0 secret put AMAP_WEB_SERVICE_KEY
pnpm dlx wrangler@4.118.0 secret put AMAP_WEB_JS_KEY
pnpm dlx wrangler@4.118.0 secret put AMAP_JS_SECURITY_CODE
pnpm dlx wrangler@4.118.0 secret put ZHAOLU_SESSION_SECRET
```

`ZHAOLU_SESSION_SECRET` 至少 32 个随机字符。高德 JS Key 是浏览器端公开标识，但仍通过 Secret 管理，避免开发者误把整套配置复制进仓库；真正必须保密的是 Web 服务 Key 和安全密钥。

## 4. 迁移和部署

```bash
pnpm run cloudflare:migrate:remote
pnpm run cloudflare:deploy
```

如果 Cloudflare 的静态资源上传接口临时返回 `HTTP 500`，可使用兼容部署：

```bash
pnpm run cloudflare:deploy:inline
```

该命令把当前 Vite 构建产物嵌入 Worker 包，不使用 R2、KV 或额外收费资源。页面和 API 仍在同一域名；接口恢复后可直接切回标准部署命令。

部署后验证：

```text
GET /api/v1/health
GET /api/v1/ready
GET /api/v1/map-config
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

- `CLOUDFLARE_API_TOKEN`：默认仅授予目标账号所需的 Workers Scripts 和 D1 权限；只有启用可选 R2 缓存后才增加 R2 权限。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID。

高德 Key 和 `ZHAOLU_SESSION_SECRET` 由 `wrangler secret put` 直接保存在 Cloudflare；不要把它们写入 GitHub Actions 日志。自动化发布前仍需先手动创建 D1，并把真实 D1 资源 ID 写入部署配置。

## 免费额度与生产边界

零费用方案没有 R2 订阅，WorldCover 首次分析和跨实例重复分析会直接读取远端 COG。Workers Free 的 CPU 上限可能不足以稳定处理完整多候选路线；演示阶段先测真实请求，如果出现 CPU 超限，应减少环境分析尺寸、使用预计算数据，或在明确接受费用后升级方案。中国大陆稳定访问还涉及单独的 Cloudflare China Network 与 ICP 要求，普通 `workers.dev` 不等同于大陆部署。

## 可选 R2 缓存

代码保留 `R2CachedWorldCoverRasterSource`。以后决定启用时，创建 Bucket 并在 `wrangler.jsonc` 增加名为 `SCENERY_CACHE` 的 R2 binding 即可；没有该 binding 时会自动使用直接 COG 数据源，不影响 API 契约。
