# 预发布部署与实网验收

预发布环境用于验证真实域名、TLS、高德 Key、同源安全代理、持久卷和真实路线调用。
它必须与生产使用同一镜像，只允许 Secret、域名、额度和数据卷不同。

## 环境基线

- 单实例运行；当前 SQLite 和进程内限流不支持横向多副本；
- 使用提交 SHA 标签或镜像 digest，不使用 `latest`；
- 容器文件系统只读，仅 `/app/data` 为持久卷，`/tmp` 为临时内存盘；
- 容器删除 Linux capabilities，并启用 `no-new-privileges`；
- 服务端口默认只绑定 `127.0.0.1:8787`，由 HTTPS 反向代理对外提供服务；
- 边缘必须添加 HSTS，并把实际代理源地址写入 `ZHAOLU_TRUSTED_PROXY_RANGES`；
- 高德 Web Service Key 与 Web JS Key 分离，Web JS Key 绑定预发布域名；
- 高德路线文件导出保持关闭，除非已经按 Provider 合规决策记录完成授权复核。

## 部署顺序

1. 从待发布提交构建镜像，并记录提交 SHA 与镜像 digest；
2. 为预发布域名配置 DNS 与有效 TLS 证书；
3. 复制 `.env.staging.example` 到主机外的 Secret 管理位置并填写真实值；
4. 创建独立持久卷，确认平台快照或备份策略已开启；
5. 使用 `deploy/compose.staging.yaml` 启动单实例；
6. 确认 `/api/v1/ready` 为 `ready`，再开放边缘流量；
7. 运行下面的实网验收；
8. 保存镜像 digest、配置版本、验收输出和批准人。

示例命令：

```powershell
docker compose --env-file C:\secure\zhaolu-staging.env -f deploy/compose.staging.yaml pull
docker compose --env-file C:\secure\zhaolu-staging.env -f deploy/compose.staging.yaml up -d
```

示例中的 Secret 文件不得位于仓库或被提交到 Git；在 Linux 主机上替换为对应的绝对路径。

## 实网验收

本地或运维机运行：

```powershell
$env:STAGING_BASE_URL = "https://staging.routes.example.com"
$env:STAGING_EXPECT_WEB_MAP = "true"
$env:STAGING_EXPECT_ROUTE_EXPORTS = "false"
$env:STAGING_SMOKE_START_QUERY = "杭州黄龙体育中心"
pnpm run smoke:staging
```

也可以在 GitHub Actions 手动运行 `staging-smoke` workflow。建议给 GitHub 的
`staging` Environment 配置人工批准规则。

验收固定发出 7 个请求：health、ready、capabilities、map-config、OpenAPI、Web
首页，以及 1 个真实路线规划请求。路线请求只要求 1 条、目标 2 公里；服务端现有的
单次物理调用上限和每分钟额度继续生效。脚本验证：

- HTTPS、HSTS、CSP、防嵌入和 MIME 嗅探保护；
- API no-store 与公开契约；
- 地图配置不泄漏安全密钥；
- 高德返回 WGS-84 `LineString`；
- 路线持久化为 `metadata-only`；
- 高德 URI 与预期的导出授权状态一致。

成功输出只包含检查名、请求数、路线数和能力布尔值。失败输出为稳定错误码，不打印
响应正文、Key、地点坐标或路线几何。

## 回滚

保留上一版本的镜像 digest。验收失败时停止开放流量，恢复上一 digest 并重新运行
只读的 `pnpm run smoke:production`。数据库 schema 升级前必须先做快照；当前 schema
不支持时应用会拒绝启动，不能通过多副本滚动方式绕过。

仓库只提供平台无关的部署基线。真正创建预发布环境仍需要明确的容器平台或主机、
域名、TLS、真实高德 Key、Secret 注入方式和持久卷权限。
