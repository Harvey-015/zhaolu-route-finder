# 路线交付与用户数据

第六阶段把推荐结果交付给用户，同时保持 Provider policy、坐标和持久化边界。

## 交付方式

- GeoJSON：标准 `Feature<LineString>`，坐标为 WGS-84；
- GPX 1.1：每个路线点写入一个 `trkpt`；
- 高德 URI：在 Adapter 边界把 WGS-84 转为 GCJ-02；
- 分享链接：只编码起点、方式、距离和环境偏好，不编码路线几何；
- 重新规划：把所选路线的实际距离写回目标距离。

高德 URI 的步行和骑行模式不能携带完整自定义环线，因此页面只交接起点到路线
中点，并明确提示完整路线使用 GPX。它不会声称高德能复现找路路线。

## Provider policy

每条 API 路线携带：

```text
policyId
policyVersion
exportFormats
navigationTargets
persistence
expiresAfterSeconds
```

生产解析器只认识显式配置的 Provider；未知来源导出、导航和持久化全部拒绝。
当前高德 policy 允许 GeoJSON、GPX 和高德 URI，但持久化为
`metadata-only`，24 小时后过期。Fixture policy 只用于本地测试，允许完整
几何保存 30 天。

## 会话、数据库和反馈

- `SignedSessionService` 使用 HMAC-SHA256 签发匿名 Bearer token；
- token 和 SQLite session 必须同时有效；
- `saved_routes` 通过外键绑定匿名 user id；
- `field_reports` 绑定已有收藏，评分范围为 1–5；
- 删除收藏会级联删除反馈；
- 过期清理按反馈、收藏、会话顺序执行。

SQLite 来自 Node `node:sqlite`，项目最低版本 Node 22.13 已可无命令行开关使用。
Node 22 仍将该模块标为 active development；若生产规模、并发或迁移需求增加，
保持 `UserDataStore` 端口不变，替换为 PostgreSQL/PostGIS Adapter。

匿名设备会话不是注册用户系统，不提供跨设备恢复、密码、邮箱或第三方登录。
需要这些能力时应在此 API 边界增加正式身份 Provider，而不是把身份逻辑放入
路线核心。
