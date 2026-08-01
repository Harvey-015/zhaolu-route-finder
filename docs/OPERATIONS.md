# 监控、告警、备份与恢复

本仓库把单实例上线基线设为：RPO 不超过 24 小时、发现备份失效不超过 26 小时，
恢复演练目标 RTO 不超过 2 小时。平台上线前可按业务要求收紧，但不能在没有验证的情况下
承诺更短时间。

## 自动备份

Compose 中的 `backup` 服务与 API 使用同一个不可变镜像。服务健康后，它会立即执行一次
SQLite 在线备份，之后默认每 24 小时执行一次。每次成功必须依次完成：

1. 使用 SQLite Online Backup API 生成一致性副本，不直接复制运行中的 WAL 数据库；
2. 对副本执行 `PRAGMA quick_check`、外键检查和 schema 版本检查；
3. 把副本复制到隔离临时目录并重新打开，完成自动恢复演练；
4. 计算 SHA-256，并更新 `last-success.json`；
5. 删除超过保留期的本项目命名备份，默认保留 14 天。

数据文件和备份使用不同卷：`zhaolu-data` / `zhaolu-staging-data` 与
`zhaolu-backups` / `zhaolu-staging-backups`。这能防止单文件损坏，但不能防止节点、账号或
区域级故障。正式环境必须再把备份卷加密复制到异地对象存储，并对对象存储启用版本保留；
对象存储账号和生命周期策略属于部署平台配置，不能写入 Git。

可配置项：

```text
ZHAOLU_BACKUP_DIRECTORY=/app/backups
ZHAOLU_BACKUP_INTERVAL_HOURS=24  # 1..168
ZHAOLU_BACKUP_RETENTION_DAYS=14 # 1..365
```

本地完成构建后可单次运行：

```powershell
$env:ZHAOLU_DATABASE_PATH = "data/zhaolu.sqlite"
$env:ZHAOLU_BACKUP_DIRECTORY = "backups"
pnpm run backup:database
```

命令只输出文件名、时间、大小和清理数量，不输出用户数据或 Secret。

## 恢复验证与实际恢复

对任意备份进行只读恢复演练：

```powershell
$env:ZHAOLU_BACKUP_FILE = "backups/zhaolu-<timestamp>.sqlite"
pnpm run verify:restore
```

该命令复制到临时目录后检查完整性、外键、schema 版本以及三张用户数据表的可读性，
不会覆盖生产数据库。

实际恢复是有停机和覆盖风险的运维操作，必须由当班人员明确选择备份并记录审批：

1. 宣布维护并停止 API 与 `backup` 服务；
2. 保存当前故障数据库及 `-wal`、`-shm` 文件，不直接删除；
3. 对选中的备份执行 `verify:restore`，核对 SHA-256 与 `last-success.json`；
4. 把已验证副本恢复到新的数据卷，再以同版本镜像启动；
5. 检查 `/api/v1/ready`，并抽查会话隔离、收藏和高德仅保存 metadata 的约束；
6. 记录实际 RPO/RTO、影响范围和回滚点，再解除维护。

不要在 API 仍写入 SQLite 时替换数据库文件，也不要让多个 API 副本共享同一个 SQLite 卷。

## Prometheus 与告警

API 通过受 Bearer token 保护的 `/internal/metrics` 暴露：

- 按归一化路径、方法和状态统计的请求数量与累计耗时；
- 当前请求数和进程启动时间；
- 最近一次已验证备份、恢复演练的 Unix 时间戳与备份大小。

示例抓取配置在 `deploy/prometheus.example.yaml`，规则在
`deploy/prometheus.rules.yaml`。凭据必须通过只读 Secret 文件提供，不应直接写入 YAML。
规则覆盖服务不可达、就绪失败、重启循环、5xx 比例、规划延迟、限流突增、备份过期和恢复
验证过期。

部署后可从 GitHub Actions 手动运行 `operations-smoke`，或本地执行：

```powershell
$env:OPERATIONS_BASE_URL = "https://routes.example.com"
$env:ZHAOLU_OBSERVABILITY_TOKEN = "<独立监控 token>"
pnpm run smoke:operations
```

GitHub 的 `staging` Environment 必须配置 `STAGING_OBSERVABILITY_TOKEN` Secret。检查只访问
受保护指标和 readiness，不调用路线 Provider。

上线时还必须在 Alertmanager 或托管监控平台配置真实通知目的地和升级路径，至少包括：

- critical：立即通知当班人员，5 分钟无人确认则升级；
- warning：工作时段处理并进入问题清单；
- 每月触发一次人工恢复演练，保存结果、RPO/RTO 和改进项。

仓库无法替代监控平台账号、短信/邮件/IM 通知通道和异地对象存储。选定平台时需要提供这些
登录或由管理员完成授权，之后再把示例配置落到真实环境。

## 上线验收

- `backup` 服务启动后产生首个备份，并在 60 秒内出现在指标中；
- 临时破坏一个副本时，恢复验证必须失败且不得更新成功元数据；
- Prometheus 能用独立 token 抓取，公网匿名请求必须返回 401；
- 人工触发每条告警并确认通知、确认、升级和恢复闭环；
- 从异地副本恢复到空卷，完成一次计时演练并记录 RPO/RTO。
