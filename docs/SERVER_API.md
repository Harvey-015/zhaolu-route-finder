# Server API v1

Server API 提供一个不依赖 Web 框架的 Fetch API Handler，并通过 Node HTTP
Adapter 在本地运行。核心推荐、地图 Provider、风景 Provider 和路线交付不依赖
HTTP。

## 本地启动

服务端需要高德 Web 服务 Key。Key 只能通过环境变量注入，不应放入请求、代码或
Git：

```powershell
$env:AMAP_WEB_SERVICE_KEY = "<server-key>"
$env:ZHAOLU_SESSION_SECRET = "<至少 32 个字符的随机 Secret>"
pnpm run start:api
```

默认监听：

```text
http://127.0.0.1:8787
```

可以通过 `HOST` 和 `PORT` 修改监听地址，通过
`ZHAOLU_DATABASE_PATH` 修改 SQLite 文件位置，默认是
`data/zhaolu.sqlite`。当前匿名设备会话具有鉴权和过期策略，但生产限流要在
第七阶段完成，因此此时仍不应直接暴露到公网。

## 接口

```text
GET  /api/v1/health
GET  /api/v1/ready
GET  /api/v1/capabilities
GET  /api/v1/openapi.json
POST /api/v1/routes/plan
POST /api/v1/session
GET  /api/v1/saved-routes
POST /api/v1/saved-routes
DELETE /api/v1/saved-routes/{routeId}
POST /api/v1/saved-routes/{routeId}/feedback
```

机器可读契约由 `/api/v1/openapi.json` 提供，格式为 OpenAPI 3.1。

## 路线请求

所有外部点坐标必须明确声明为 WGS84：

```json
{
  "schemaVersion": "1",
  "requestId": "example-001",
  "start": {
    "kind": "point",
    "longitude": 120.145,
    "latitude": 30.26,
    "crs": "WGS84",
    "label": "起点"
  },
  "mode": "running",
  "targetDistanceMeters": 5000,
  "preferences": {
    "greenery": 1,
    "waterfront": 0.8,
    "lowTraffic": 0.7,
    "comfort": 0.5
  },
  "maxResults": 3
}
```

起点和最多三个必经点也可以使用地点查询：

```json
{
  "kind": "query",
  "query": "杭州西湖"
}
```

响应中的点和路线使用 GeoJSON `Point` 与 `LineString`。内部 Provider 坐标、
高德原始 DTO 和服务端 Key 不会出现在公共契约中。

每条路线包含 `delivery` policy snapshot，声明允许的导出格式、地图 App
交接、持久化等级和过期时间。客户端不能自行扩大这些权限。

## 匿名设备会话

`POST /api/v1/session` 创建一个 HMAC-SHA256 签名的短期 Bearer token。收藏、
删除和反馈接口必须携带：

```text
Authorization: Bearer zhaolu.v1....
```

会话默认 30 天过期。Web 将 token 保存在同源浏览器存储中；它只代表匿名设备，
不是手机号、邮箱或第三方账号登录。SQLite 使用外键隔离每个会话的数据。

高德路线当前 policy 为 `metadata-only`：可以保存名称、距离、得分、请求条件和
policy snapshot，但不长期保存路线几何。Fixture 路线允许保存完整几何，未知
Provider 默认拒绝。

## 稳定错误

错误统一返回：

```json
{
  "schemaVersion": "1",
  "requestId": "example-001",
  "error": {
    "code": "INVALID_REQUEST",
    "retryable": false,
    "details": {
      "field": "start.crs"
    }
  }
}
```

API 不返回上游响应正文、内部异常消息或密钥。请求体上限为 64 KiB，单次规划
默认最长 45 秒；HTTP 客户端取消会传递到核心及 Provider。

生产运行时还提供需要独立 Bearer token 的 `/internal/metrics`。该接口不属于
公共 v1 业务契约，细节见 `docs/DEPLOYMENT.md`。

## 本地离线冒烟

下面的命令会在随机本机端口启动 API，依次调用 health、capabilities 和 plan。
规划使用 Fake Provider，不消耗高德或 WorldCover 配额：

```powershell
pnpm run smoke:api
```
