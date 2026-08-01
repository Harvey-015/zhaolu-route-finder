# 封闭测试与公测发布清单

代码仓库从 Private 转为 Public 的独立步骤见
[`docs/OPEN_SOURCE_RELEASE.md`](OPEN_SOURCE_RELEASE.md)。仓库公开不代表产品发布门禁已经通过。

## 当前结论

仓库级架构、部署基线、隐私能力、运行保障和发布门禁已经具备；真实环境尚未创建和验收时，
发布结论必须保持 **No-Go**。代码合并、CI 全绿或本地演示都不能替代域名、Key、备份、告警、
实网路线和人工审批证据。

复制 `release/evidence.example.json` 为 `release/evidence.json`，逐项替换真实提交 SHA、镜像
digest、工作流 URL、检查时间和审批人。该文件不允许包含 Secret、用户数据、路线几何或内部
Provider 响应。执行：

```powershell
$env:RELEASE_EVIDENCE_FILE = "release/evidence.json"
pnpm run release:check
```

也可运行 GitHub Actions 的 `release-readiness`。模板中的 `pending` 会按设计返回 No-Go；
不得把状态手工改成 `passed` 而不填写真实证据 URL。

## 需要的账号与权限

实际执行前一次性准备：

- 容器部署平台：创建预发布/生产服务、持久数据卷、独立备份卷和异地对象存储；
- DNS/TLS：管理最终域名、证书、HSTS 和反向代理来源网段；
- 高德开放平台：Web Service Key、Web JS Key、安全密钥和生产域名绑定；
- GitHub `staging` Environment：部署所需 Secret、`STAGING_OBSERVABILITY_TOKEN` 和人工批准；
- 监控平台/Alertmanager：指标抓取、通知联系人、确认和升级路径；
- 运营与隐私：正式运营主体、公开联系方式、隐私/条款和日志保存期限；
- Provider/法律：核实高德数据使用和导出策略；大陆部署所需备案或许可由负责人按实际主体、
  服务形态和部署地确认；
- 当班与支持：事故联系人、用户反馈入口和维护公告发布权限。

任何 Secret 只在平台 Secret 管理中配置。需要登录或管理员授权时直接由对应账号持有人完成，
不要通过聊天、Issue、PR 或证据 JSON 传递明文。

## 封闭测试 Go/No-Go

以下 10 个 gate 和 4 个审批全部通过，才允许给受邀用户开放：

| Gate | 必需证据 |
|---|---|
| `ci` | 同一 commit SHA 的 verify/browser/container 全绿 URL |
| `staging-smoke` | HTTPS/HSTS/API/地图/一次真实规划工作流 URL |
| `operations-smoke` | 指标受保护、备份和恢复验证新鲜、ready 通过 |
| `city-acceptance` | 杭州、上海、成都三城市通过 |
| `edge-load` | 成功率、p95、状态码分布和工作流 URL |
| `route-load` | 已批准额度的 10 请求/2 并发结果 |
| `security-review` | 静态扫描、生产依赖审计和真实域名安全复核 |
| `backup-restore-drill` | 从异地副本恢复到空卷的 RPO/RTO 记录 |
| `provider-authorization` | 导出关闭，或有效合同/工单引用与回滚方式 |
| `privacy-terms-review` | 运营主体、联系方式、同意和删除流程复核 |

审批角色：engineering、product、operations、privacy。任何 high/critical 未解决风险均为
No-Go；low/medium 风险必须有 owner、接受人和未来到期时间。

封闭测试建议先限量邀请，明确“路线建议不等于道路安全保证”，收集反馈时不要求用户提交精确
住址、完整轨迹或不必要的个人信息。

## 公测额外条件

从 `closed-beta` 切换到 `public-beta` 时，除上述全部项目外，还必须增加：

- `closed-beta-observation`：约定观察期内无未解决 P0/P1，关键 SLO 和 Provider 额度稳定；
- `incident-drill`：完成服务不可用、Key 泄漏、备份失败和错误路线投诉演练；
- `support-readiness`：用户反馈、隐私请求、删除请求和维护公告有人负责且有响应时限；
- `legal-launch-review`：最终域名、运营主体、部署地、地图数据用途和公开文本完成发布前复核；
- legal 审批。

公测流量应分批开放。先观察错误率、p95、429、Provider 配额和备份指标，再扩大入口；不要在
告警无人接收、异地恢复未演练或回滚镜像不可用时扩大流量。

## 发布当天

1. 冻结发布 commit，记录当前和上一镜像 digest；
2. 对数据卷做发布前快照，确认最近备份和自动恢复验证未超过 26 小时；
3. 运行 `release:check`，由所有要求角色确认同一份证据；
4. 部署不可变 digest，不使用 `latest`；
5. 运行 production smoke，不调用路线 Provider；
6. 先开放小比例流量，观察至少一个完整监控窗口；
7. 检查 5xx、p95、429、ready、备份、Provider 配额和用户反馈；
8. 记录发布完成时间、实际变更、异常和下一检查点。

以下任一情况触发停止扩量或回滚：ready 失败、持续 5xx/延迟告警、路线请求大面积失败、
Provider 额度异常、Key/用户数据疑似泄漏、备份或恢复验证过期、无法确认删除请求生效。

## 回滚与事故

- 停止开放新流量，保留日志和证据，不在事故中直接删除数据；
- 回滚到已记录的上一镜像 digest；
- 数据 migration 失败时只从已验证副本恢复到新卷，不覆盖仍在写入的 SQLite；
- Key 疑似泄漏时先吊销/轮换，再恢复服务；
- 涉及隐私、地图合规或用户安全时立即通知对应负责人；
- 恢复后重跑只读烟雾、operations smoke，并记录根因和防复发项。

详细恢复步骤见 `docs/OPERATIONS.md`，实网质量门禁见 `docs/RELEASE_GATES.md`，隐私与
Provider 边界见 `docs/PRIVACY_AND_TERMS.md` 和 `docs/PROVIDER_COMPLIANCE.md`。
