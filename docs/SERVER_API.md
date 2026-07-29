# Server API v1

第四阶段提供一个不依赖 Web 框架的 Fetch API Handler，并通过 Node HTTP
Adapter 在本地运行。核心推荐、地图 Provider 和风景 Provider 不依赖 HTTP。

## 本地启动

服务端需要高德 Web 服务 Key。Key 只能通过环境变量注入，不应放入请求、代码或
Git：

```powershell
$env:AMAP_WEB_SERVICE_KEY = "<server-key>"
pnpm run start:api
```

默认监听：

```text
http://127.0.0.1:8787
```

可以通过 `HOST` 和 `PORT` 修改监听地址。当前阶段没有用户鉴权、数据库和生产
限流，因此不要直接暴露到公网。

## 接口

```text
GET  /api/v1/health
GET  /api/v1/capabilities
GET  /api/v1/openapi.json
POST /api/v1/routes/plan
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

## 本地离线冒烟

下面的命令会在随机本机端口启动 API，依次调用 health、capabilities 和 plan。
规划使用 Fake Provider，不消耗高德或 WorldCover 配额：

```powershell
pnpm run smoke:api
```
