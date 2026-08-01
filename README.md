# 找路

找路是一个面向跑步和骑行场景的风景路线推荐项目。

项目目标不是重做底层路线引擎，而是在地图服务提供的真实可通行道路上，结合环境特征、用户偏好和路线多样性，推荐距离合适且风景更好的路线。

## 当前状态

七个阶段的仓库实现已经完成：

- 与地图供应商无关的地点、路线、环境特征和评分模型；
- WGS-84 与 GCJ-02 类型边界；
- `findScenicRoutes` 应用用例；
- 可替换的地点、路线、环境和评分端口；
- 可替换的候选生成与路线选择纯策略；
- Fake Provider 和完全离线的核心测试；
- 调用预算、并发、取消、降级和稳定错误契约。
- 高德地点解析与步行、骑行路线 Adapter；
- 高德 DTO、运行时校验和内部模型 Mapper；
- 集中的 GCJ-02/WGS-84 转换；
- 集中的超时、有限重试、取消、额度和错误转换；
- 途经点路段拆分、调用上限和路线合并；
- 高德离线契约测试和受控在线冒烟；
- ESA WorldCover COG 环境特征 Adapter 和受控在线冒烟；
- 版本化 Server API、OpenAPI、健康检查和本地 HTTP 冒烟；
- React Web UI、路线条件、结果比较和可注入 `BasemapRenderer`；
- 高德 JS API 2.0 底图、服务端安全密钥代理和无 Key SVG 降级；
- 桌面和移动端浏览器验收；
- 注册式 `RouteExporter`、`NavigationLinkProvider`，以及受 Provider
  policy 控制的 GPX、GeoJSON 和高德 URI 路线交付；
- Provider policy 控制的路线持久化与过期策略；
- 匿名签名会话、SQLite 收藏和现场反馈；
- 共享搜索条件和按路线实际距离重新规划；
- 单进程生产运行时、Docker/Compose 和 GitHub Actions；
- 启动配置校验、限流、探针、指标、脱敏日志和优雅关闭；
- SQLite 在线备份、自动恢复验证和 Prometheus 告警规则；
- 覆盖核心、Provider、API、持久化和 Web 客户端的完整自动化测试集。

服务端 Key 和会话签名 Secret 只通过环境变量注入，仓库不包含任何真实 Secret。
实际生产发布仍需要外部容器平台、域名、TLS、Secret 注入和持久数据卷。

## 架构边界

```text
调用方
  ↓
findScenicRoutes
  ├─ PlaceProvider
  ├─ RouteProvider
  ├─ SceneryProvider
  ├─ RouteScoringPolicy
  ├─ CandidateGenerationStrategy
  └─ RouteSelectionStrategy
```

核心代码只依赖内部 TypeScript 模型，不依赖 React、Next.js、Cloudflare、数据库或第三方地图 SDK。

高德基础设施代码位于 `src/adapters/amap`，实现 `PlaceProvider`、`RouteProvider`
和高德导航交接；这些实现不会反向进入路线核心。

完整设计见 [架构文档](docs/ARCHITECTURE.md)。
Web 本地运行方式见 [Web UI 文档](docs/WEB_UI.md)，Server API 见
[接口文档](docs/SERVER_API.md)，路线交付和数据策略见
[路线交付文档](docs/ROUTE_DELIVERY.md)，Provider 授权门禁见
[合规决策记录](docs/PROVIDER_COMPLIANCE.md)，生产运行见
[部署文档](docs/DEPLOYMENT.md)，预发布实网验收见
[预发布文档](docs/STAGING.md)，隐私、条款与数据权利见
[隐私与条款文档](docs/PRIVACY_AND_TERMS.md)，监控、告警和恢复见
[运行保障文档](docs/OPERATIONS.md)。

## 开发命令

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm exec playwright install chromium
pnpm run test:e2e
```

`test:e2e` 会启动本地 Fixture API 与 Vite，并用 Chromium 验证路线生成、
收藏和刷新恢复主流程；CI 会自动安装对应浏览器。

## 下一阶段

选择生产容器平台并配置域名、TLS、Secret 与 SQLite 持久卷；发布后运行只读
生产烟雾。需要多实例时，再把限流迁移到 Redis、数据层迁移到 PostgreSQL。
