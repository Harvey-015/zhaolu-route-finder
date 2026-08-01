# 参与找路开发

感谢你帮助改进找路。项目欢迎修复缺陷、改进文档、新增测试，以及接入新的地图、路线、环境数据和推荐算法。

## 开始之前

- 阅读 [架构文档](docs/ARCHITECTURE.md)，尤其是 Provider 边界和坐标系约束；
- 搜索现有 Issue，避免重复工作；
- 较大的产品、数据源或接口变更先创建 Feature 或 Provider integration Issue；
- 不要在 Issue、PR、测试夹具或日志中提交 Key、Token、精确个人位置或真实用户路线。

## 本地环境

- Node.js 24；仓库最低运行要求见 `package.json`；
- pnpm 11.9.0；
- Chromium 仅在运行浏览器测试时需要；
- Docker 仅在验证容器构建或 Compose 配置时需要。

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm exec playwright install chromium
pnpm run test:e2e
```

默认测试必须离线、可重复且不消耗任何第三方 Provider 配额。高德、WorldCover、预发布环境和压测脚本只在对应文档规定的受控条件下运行。

## 架构约束

### 新增地点、路线或环境 Provider

1. 在 `src/route-recommendation/ports.ts` 中复用现有端口；只有现有契约无法表达通用能力时才修改端口；
2. 在 `src/adapters/<provider>/` 中实现适配器，不要把第三方 DTO 带入核心；
3. 在组合根注册 Provider，不要在 `findScenicRoutes` 或 React 页面中增加供应商名称分支；
4. 明确坐标系、超时、重试、额度、缓存、归属文字和数据留存边界；
5. 添加离线契约测试，在线冒烟必须默认关闭并限制真实请求数量。

### 新增地图图层

- 通过 `MapLayerProviderRegistry` 注册；
- 声明 `coordinateSystem` 和 `attribution`；
- 记录图层是否允许缓存、截图、混合展示和派生分析；
- 无法确认与当前路线 Provider 混合展示时，应新增完整 Provider profile。

### 新增推荐算法

- 实现纯策略并注册版本化 Profile；
- 相同输入必须产生稳定输出；
- 提供边界测试和与现有 Profile 的行为对比；
- 不要让算法直接访问 React、数据库、网络或第三方 SDK。

## 提交要求

- 每个 PR 聚焦一个问题；
- 新行为必须包含测试或解释为什么无法自动测试；
- 用户可见行为、部署变量或扩展点变化必须同步文档；
- 保持 TypeScript 类型边界，不使用 `any` 绕过 Provider 契约；
- 不提交构建产物、`.env`、数据库、测试报告或真实 Provider 响应；
- 提交信息建议使用 `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:` 前缀。

提交 PR 前运行：

```bash
pnpm run security:static
pnpm run security:history
pnpm run typecheck
pnpm run test
pnpm run test:e2e
```

PR 必须通过 CI，并完成模板中的安全、坐标系、Provider 合规和文档检查。维护者可能要求拆分过大的变更或补充真实环境验证计划。

## 许可证

除非明确另行说明，你提交并由项目接收的 Contribution 将按 [Apache License 2.0](LICENSE) 授权。提交者必须有权提供相关代码、文档、数据或素材。

## 获取帮助

普通使用和开发问题见 [SUPPORT.md](SUPPORT.md)。安全问题不要创建公开 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告。
