# 找路

找路是一个面向跑步和骑行场景的风景路线推荐项目。

项目目标不是重做底层路线引擎，而是在地图服务提供的真实可通行道路上，结合环境特征、用户偏好和路线多样性，推荐距离合适且风景更好的路线。

## 当前状态

第一阶段核心架构已经完成：

- 与地图供应商无关的地点、路线、环境特征和评分模型；
- WGS-84 与 GCJ-02 类型边界；
- `findScenicRoutes` 应用用例；
- 可替换的地点、路线、环境和评分端口；
- 可替换的候选生成与路线选择纯策略；
- Fake Provider 和完全离线的核心测试；
- 调用预算、并发、取消、降级和稳定错误契约。

当前仓库不包含旧原型页面、真实高德接入、WorldCover 接入、Worker API、数据库或部署配置。

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

完整设计见 [架构文档](docs/ARCHITECTURE.md)。

## 开发命令

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

## 下一阶段

下一阶段只增加高德地点和路线 Adapter、第三方 DTO Mapper 及契约测试，不修改核心算法和前端页面。
