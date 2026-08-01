# 部署与运行保障

第七阶段提供单容器模块化单体：同一个 Node 进程提供 `/api/v1`、构建后的 React
静态文件、就绪探针和受保护的 Prometheus 指标。

## 运行前提

- Node 24（容器基线）；
- 高德 Web Service Key；
- 高德 Web JS Key 与配套安全密钥；
- 最终 HTTPS 站点来源，例如 `https://routes.example.com`；
- 两个彼此独立、至少 32 字符的随机 Secret：
  `ZHAOLU_SESSION_SECRET` 和 `ZHAOLU_OBSERVABILITY_TOKEN`；
- SQLite 数据卷的持久目录；
- 外部 HTTPS 反向代理或负载均衡器；
- 实际运营主体、可公开的隐私联系方式，以及外部日志平台保存天数。

复制 `.env.example` 到部署平台的 Secret/环境变量配置，不要把实际值写回文件或
Git。生产配置校验会在监听端口前失败，错误只包含变量名，不包含变量值。

## 本地生产运行

```powershell
pnpm install --frozen-lockfile
pnpm run build
$env:AMAP_WEB_SERVICE_KEY = "<server-key>"
$env:AMAP_WEB_JS_KEY = "<browser-web-key>"
$env:AMAP_JS_SECURITY_CODE = "<server-only-js-security-code>"
$env:ZHAOLU_PUBLIC_ORIGIN = "https://routes.example.com"
$env:AMAP_ROUTE_EXPORTS_ALLOWED = "false"
$env:ZHAOLU_OPERATOR_NAME = "<实际运营主体全称>"
$env:ZHAOLU_PRIVACY_CONTACT = "<隐私联系邮箱或其他公开联系方式>"
$env:ZHAOLU_LOG_RETENTION_DAYS = "30"
$env:ZHAOLU_SESSION_SECRET = "<random-secret-at-least-32-characters>"
$env:ZHAOLU_OBSERVABILITY_TOKEN = "<different-random-secret-at-least-32-characters>"
pnpm run start:production
```

默认监听 `0.0.0.0:8787`，静态文件来自 `web-dist`，数据库为
`data/zhaolu.sqlite`。

运营主体与隐私联系方式缺失时生产进程拒绝启动。日志天数是公开承诺，必须同步配置到
实际日志平台；隐私政策、服务条款和级联删除说明见 `docs/PRIVACY_AND_TERMS.md`。

高德 Web JS Key 会通过 `/api/v1/map-config` 下发给浏览器，应在高德控制台绑定
生产域名。`AMAP_JS_SECURITY_CODE` 不下发；Node 运行时只允许来自
`ZHAOLU_PUBLIC_ORIGIN` 的浏览器请求访问 `/_AMapService`，并且只转发白名单内的
高德路径。开发时来源可以是 `http://127.0.0.1:5173`，非本机来源必须使用 HTTPS。

高德路线的 GPX/GeoJSON 导出默认关闭。只有已经取得且核实覆盖该数据用途的合同或
书面授权时，才可同时设置：

```text
AMAP_ROUTE_EXPORTS_ALLOWED=true
AMAP_ROUTE_EXPORT_AUTHORIZATION_REFERENCE=<合同、工单或审批记录编号>
```

缺少授权依据时进程会在监听端口前拒绝启动。该编号只作为部署审计线索，不会返回给
客户端。核实要求和回滚方式见 `docs/PROVIDER_COMPLIANCE.md`。

生产环境位于反向代理或负载均衡器后时，必须把代理实际使用的源地址或 CIDR 写入
`ZHAOLU_TRUSTED_PROXY_RANGES`，例如 `10.20.0.0/16,fd00:20::/64`。默认值为空，
此时服务忽略所有 `X-Forwarded-For`，只使用 TCP 对端地址。不要填写整个公网或
未经平台确认的宽泛网段；直连服务端的来源必须无法访问受信代理入口。服务会从
右向左跳过受信代理，只采用距离服务最近的非受信地址作为限流身份，客户端伪造的
更早转发地址不会扩大额度。非法地址或 CIDR 会阻止生产进程启动。

## 容器

```powershell
docker compose up --build
```

`Dockerfile` 使用 Node 24、多阶段构建、非 root 用户、只复制生产依赖，并声明：

- `/app/data` 数据卷；
- `8787` 服务端口；
- `/api/v1/ready` 容器健康检查；
- `SIGTERM` 优雅关闭和 10 秒默认排空窗口。

当前机器未安装 Docker，因此仓库内已验证 TypeScript 构建和统一生产运行时，
镜像构建由 GitHub Actions 的 `container` job 验证。

## 探针和监控

```text
GET /api/v1/health   # 进程存活
GET /api/v1/ready    # SQLite 和 web-dist 就绪
GET /internal/metrics
```

指标接口必须携带：

```text
Authorization: Bearer <ZHAOLU_OBSERVABILITY_TOKEN>
```

指标只使用归一化路径，不记录查询字符串、收藏 UUID、地点、token、Key 或请求
正文。JSON 日志同样只记录方法、归一化路径、状态、耗时和 request id。

## 限流

默认单进程固定窗口：

- 路线规划：每客户端每分钟 30 次；
- 匿名会话：每客户端每小时 10 次；
- 收藏/反馈：每客户端每分钟 120 次。

高德物理 HTTP 尝试另有两层硬上限：单次规划默认 24 次、整个进程默认每分钟
300 次；每次重试和每个拆分路段都实际消费一次。分别通过
`AMAP_MAX_HTTP_ATTEMPTS_PER_PLAN` 和 `AMAP_MAX_HTTP_ATTEMPTS_PER_MINUTE`
调整。达到上限后会在发出下一个高德请求前失败，避免逻辑 Provider 调用数掩盖
拆分路段和重试产生的真实配额消耗。

可用 `.env.example` 中的变量调整。响应为稳定的 `RATE_LIMITED` 错误，并携带
`Retry-After`。

限流器在进程内，SQLite 也面向单实例部署。需要横向扩容前，应把限流替换为
Redis，把 `UserDataStore` 替换为 PostgreSQL/PostGIS；不要直接运行多个共享
同一 SQLite 文件的容器。

## 数据、备份和过期

启动时和每小时清理过期会话、收藏和反馈。数据卷需要平台快照或停机文件备份。
SQLite 使用 `PRAGMA user_version` 和顺序事务 migration；旧的未版本化数据库会在
首次启动时升级为 schema v1，版本高于当前程序支持范围时会拒绝启动。每次发布前
仍必须先做数据卷快照；migration 负责原子升级和失败回滚，不代替可恢复备份。
恢复演练应确认：

1. SQLite 文件能打开且 `/api/v1/ready` 返回 `ready`；
2. 匿名收藏仍按 user id 隔离；
3. 高德路线仍只有 metadata，不出现长期 geometry。

## 生产烟雾

部署后执行：

```powershell
$env:PRODUCTION_BASE_URL = "https://routes.example.com"
pnpm run smoke:production
```

烟雾只发 5 个只读请求：health、ready、capabilities、legal-config 和 Web 首页；不会调用路线
Provider，也不消耗高德或 WorldCover 配额。

预发布环境另有包含 1 次真实高德路线规划的受控验收，以及只读容器、不可变镜像、
HTTPS/HSTS 和回滚要求，见 `docs/STAGING.md`。该验收不能直接在生产环境例行运行。

## 发布门禁

`.github/workflows/ci.yml` 在 push 和 PR 上执行：

1. 锁文件安装；
2. typecheck；
3. 完整测试与生产构建；
4. Docker 镜像构建。

真正发布仍需要选定容器平台、域名、TLS、Secret 注入和数据卷；这些是仓库外的
部署状态，不应在没有账号和目标环境时假装完成。
