# 真实城市验收、压测与安全门禁

这些门禁只允许针对预发布环境执行。仓库中的离线测试证明契约和边界，不能替代真实高德、
真实 WorldCover、真实网络和真实容器平台的结果。

## 1. 多城市实网验收

默认顺序执行杭州西湖、上海世纪公园、成都青龙湖三个用例，总共只发送 3 个路线规划请求，
不并发、不重试。每个响应必须满足：

- 至少 1 条、最多 3 条路线，request id 和 schema 版本正确；
- 路线来自 `amap-route`，距离位于目标的 50% 到 175%；
- WGS-84 LineString 至少两个点，全部落在中国区域的粗边界内；
- 路线 id 不重复，评分为有限数值；
- 输出只保留城市、完整/部分状态、路线数量和耗时，不输出几何或 Provider 响应。

GitHub Actions 手动运行 `city-acceptance`，也可本地执行：

```powershell
$env:CITY_ACCEPTANCE_BASE_URL = "https://staging.routes.example.com"
$env:CITY_ACCEPTANCE_CONFIRMATION = "staging-only-three-live-requests-approved"
pnpm run acceptance:cities
```

可通过 `CITY_ACCEPTANCE_CASES_JSON` 提供 1 到 5 个用例。变更城市集后要记录原因，避免为了
通过门禁而删除失败城市。

## 2. 受控压测

`load-test` 工作流有两个 profile：

- `edge-read`：默认 200 请求、20 并发，只读 `/api/v1/ready`，不消耗 Provider 额度，
  默认要求成功率至少 99%、p95 不超过 1 秒；
- `route-plan`：默认建议 10 请求、2 并发，最多 50 请求、5 并发，会真实消耗高德和
  WorldCover 额度；必须勾选 Provider 额度确认，默认要求成功率至少 99%、p95 不超过
  15 秒。

本地路线压测示例：

```powershell
$env:LOAD_TEST_BASE_URL = "https://staging.routes.example.com"
$env:LOAD_TEST_PROFILE = "route-plan"
$env:LOAD_TEST_REQUESTS = "10"
$env:LOAD_TEST_CONCURRENCY = "2"
$env:LOAD_TEST_P95_LIMIT_MS = "15000"
$env:LOAD_TEST_CONFIRMATION = "staging-only-provider-quota-approved"
pnpm run load:staging
```

脚本不重试，输出成功率、状态码分布、平均值、p50、p95、p99 和最大耗时。遇到 429 时先检查
本应用限流与高德额度，不要直接提高并发。SQLite 和进程内限流仍是单实例基线，本轮不用于
证明横向扩容能力。

## 3. 安全门禁

每次 CI 的 `verify` job 在构建和测试之前执行：

1. `security:static` 扫描所有已跟踪和未忽略文件，拒绝私钥、常见 GitHub/AWS token、
   Slack webhook、意外提交的 `.env` 和示例环境中的字面 Secret；
2. 检查非 root Docker 用户、预发布只读文件系统、capability 删除、
   `no-new-privileges`、不可变镜像要求和 workflow 最小权限声明；
3. `pnpm audit --prod --audit-level high` 阻止高危或严重生产依赖漏洞；
4. Dependabot 每周检查 npm 与 GitHub Actions 更新；
5. 后续 job 继续验证 Compose、Prometheus、浏览器和容器构建。

静态扫描是快速门禁，不等同于渗透测试。封闭测试前仍应针对真实域名做授权范围内的 DAST、
限流绕过、反向代理来源、CSP 和 Secret 注入检查。

## 4. 执行顺序与证据

1. CI 全绿；
2. 部署不可变镜像到预发布；
3. 运行只读 staging smoke 和 operations smoke；
4. 运行三个真实城市用例；
5. 先跑 `edge-read`，再在额度批准后跑 `route-plan`；
6. 保存工作流 URL、镜像 digest、提交 SHA、时间、成功率、p95 和失败说明；
7. 任一失败先修复和重跑，不以人工口头确认覆盖门禁。

实网执行需要预发布 HTTPS URL、部署好的高德 Key，以及 operations smoke 使用的独立监控
token。缺少时应明确向部署管理员索取，不应改用生产环境或把 Secret 写入仓库。
