# 开放源代码发布清单

本清单只处理仓库从 Private 转为 Public 的准备工作，不替代产品生产上线门禁。代码可以先开源，公开服务仍须通过 `docs/LAUNCH_CHECKLIST.md`。

## 1. 冻结待公开版本

1. 所有变更从功能分支通过 PR 合并；
2. 运行 `security:static` 和 `security:history`；
3. 运行 typecheck、完整测试、浏览器测试和容器构建；
4. 确认 `.env`、数据库、日志、测试报告和构建产物均未跟踪；
5. 检查 GitHub Actions 历史、缓存和 artifact 是否包含不应公开的信息；
6. 轮换任何曾经通过聊天、终端录屏或其他非 Secret 管理渠道传递的生产凭据。

## 2. 检查公开材料

- `LICENSE`、README、贡献指南、安全策略和行为准则可访问；
- Issue/PR 模板不要求用户提交精确位置、Key 或 Provider 原始响应；
- 路线图不承诺未经验证的发布日期或生产能力；
- 第三方商标、地图署名、数据许可证和 Provider 授权边界表述准确；
- README 明确代码许可证不等于地图或数据授权。

## 3. 更改仓库可见性

由仓库管理员在 GitHub Settings 中执行 Private → Public。更改前再次确认目标仓库为 `Harvey-015/zhaolu-route-finder`，并记录执行人和时间。

更改后立即检查：

- Actions、Issues 和 Discussions 的可见性；
- Private vulnerability reporting 已启用；
- Dependabot alerts、dependency graph、secret scanning 和 code scanning 已启用；
- 仓库描述、Topics、主页地址和社交预览正确；
- Community Standards 页面识别到许可证、贡献指南、行为准则和模板。

## 4. 保护 `main`

创建处于 Active 状态的 branch ruleset，目标为默认分支，并至少启用：

- Require a pull request before merging；
- 至少 1 个 approval，合并前解决全部 review conversation；
- Require status checks：`verify`、`browser`、`container`；
- Require branches to be up to date before merging；
- Block force pushes 和 branch deletion；
- 维护者同样遵守规则，不配置日常绕过。

如果个人仓库当前套餐或协作者数量无法满足某项规则，必须在首个公开 Release 中记录临时例外和补齐条件。

## 5. 建立首批社区入口

- 创建 `good first issue`、`help wanted`、`provider`、`security`、`documentation` 等标签；
- 从 `ROADMAP.md` 建立少量边界清晰的 Issue；
- 为新 Provider 指定技术契约和合规验收人；
- 公布支持边界，不承诺社区项目无法持续满足的 SLA；
- 准备首个 `v0.1.0` Release Notes，并链接 commit SHA、CI 和已知限制。

## 6. 与产品上线分离

Public 仓库不表示公开服务已经通过生产验收。网站上线仍必须满足：

- 正式域名、TLS、运营主体和隐私联系方式；
- 生产 Key、Provider 授权、持久数据卷、异地备份和真实告警；
- staging smoke、三城市验收、受控压测、恢复演练和发布证据；
- WorldCover 或替代环境数据链路达到公开承诺的可用水平；
- `release:check` 对目标阶段返回 Ready。
