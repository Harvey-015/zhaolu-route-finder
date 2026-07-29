# Web UI

第五阶段提供 React 19 + Vite 8 的路线规划界面。前端位于 `web/`，只调用
`/api/v1`，不导入生产 Provider，也不接触高德服务端 Key。

## 本地运行

使用完全离线、确定性的夹具 API：

```powershell
pnpm run dev:api:fixture
pnpm run dev:web
```

打开 `http://127.0.0.1:5173/`。夹具 API 监听 `127.0.0.1:8787`，Vite 会把
`/api` 请求代理到该端口。默认地点“杭州西湖”是夹具数据，不会访问高德或
WorldCover 网络服务。

使用真实 Provider 时，按 `docs/SERVER_API.md` 配置服务端环境变量并运行：

```powershell
pnpm run start:api
pnpm run dev:web
```

所有 Secret 只留在 API 进程中。

## 当前界面能力

- 输入起点并选择跑步或骑行；
- 选择目标距离；
- 调整绿地、水边和低建成区偏好；
- 查看加载、错误、降级和成功状态；
- 比较最多三条路线的距离、时长、得分和环境指标；
- 在 SVG 中预览 Server API 返回的 WGS-84 GeoJSON 几何；
- 在路线卡片、图形和图例之间同步选择。
- 下载 GPX 或 GeoJSON；
- 调起高德到路线中点，并明确说明不能交付完整自定义环线；
- 分享可复现的搜索条件，不在 URL 中放入 Provider 路线几何；
- 通过匿名设备会话收藏、恢复和删除路线；
- 对收藏路线提交 1–5 分现场体验；
- 采用路线实际距离调整条件后重新规划。

几何预览不是地理底图。接入高德 JS 底图需要独立 Web Key 和安全配置，不能
复用服务端 Web Service Key；在完成该配置前，界面明确标注“底图待 Web Key
接入”。

## 验证

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
```

浏览器验收覆盖默认成功流、三条路线切换、桌面布局、390 × 844 移动布局、
横向溢出和控制台错误。
