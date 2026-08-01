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
- 由浏览器在用户点击后读取一次前台当前位置，或继续手动输入地点；
- 添加、排序展示和移除最多三个必经点；
- 选择目标距离；
- 调整绿地、水边和低建成区偏好；
- 查看加载、错误、降级和成功状态；
- 比较最多三条路线的距离、时长、得分和环境指标；
- 配置 Web Key 时默认在高德卫星影像与路网图层上显示路线，并可切换标准图；
- 未配置地图或加载失败时降级为 SVG WGS-84 GeoJSON 几何预览；
- 在路线卡片、图形和图例之间同步选择。
- 在路线 Provider policy 允许时下载 GPX 或 GeoJSON；
- 调起高德到路线中点，并明确说明不能交付完整自定义环线；
- 分享可复现的搜索条件，不在 URL 中放入 Provider 路线几何；精确当前位置也不会
  写入链接，接收者需要重新定位；
- 通过匿名设备会话收藏、恢复和删除路线；
- 对收藏路线提交 1–5 分现场体验；
- 采用路线实际距离调整条件后重新规划。
- 首次规划前确认版本化隐私政策、服务条款与路线免责声明；
- 访问 `/privacy` 和 `/terms` 查看实际运营主体与处理规则；
- 一键删除匿名会话、全部设备收藏、反馈和本地同意记录。

默认 `amapBasemapRenderer` 使用高德 JS API 2.0，默认底图 Provider 是
`amap-satellite`（卫星影像 + 路网），并提供 `amap-standard` 切换；未配置或加载
失败时回退到 SVG 几何预览。Web 通过 `BasemapRenderer` 接口接收地图实现；接入
MapLibre、Google Maps 或 Leaflet 时，只需实现 `BasemapViewportProps` 对应组件，
然后注入 `App`：

```tsx
const renderer = defineBasemapRenderer({
  id: "maplibre",
  displayName: "MapLibre",
  component: MapLibreRouteMap,
});

createRoot(root).render(<App basemapRenderer={renderer} />);
```

Renderer 只接收标准 `ApiRecommendedRoute`、当前路线 ID 和选择回调。地图 SDK
生命周期、覆盖物与显示坐标转换留在 Renderer 内部；路线规划和服务端 Secret
不得进入 Renderer。高德 JS 底图需要独立 Web Key，不能复用服务端 Web Service
Key。生产配置使用 `AMAP_WEB_JS_KEY`、`AMAP_JS_SECURITY_CODE` 与
`ZHAOLU_PUBLIC_ORIGIN`。浏览器只通过 `/api/v1/map-config` 获得公开 Web Key；
安全密钥留在服务端，由同源 `/_AMapService` 白名单代理追加 `jscode`。三项缺一时
配置校验失败；三项均为空时保留 SVG 降级模式。

如果只替换卫星源或新增地形、土地覆盖、热力等可见参考数据，不需要替换整个
Renderer。高德图层类型与默认实现位于 `web/src/amapLayers.ts`；实现并注册
`MapLayerProvider<AmapMapLayerContext, AmapLayer>` 即可：

```tsx
const terrain = defineMapLayerProvider<AmapMapLayerContext, AmapLayer>({
  id: "example-terrain",
  displayName: "地形参考",
  kind: "reference",
  attribution: "Example Terrain Data",
  coordinateSystem: "WGS84",
  defaultEnabled: false,
  createLayers: ({ AMap }) => [createExampleAmapTileLayer(AMap)],
});

const layers = new MapLayerProviderRegistry([
  amapSatelliteLayerProvider,
  amapStandardLayerProvider,
  terrain,
]);

const renderer = createAmapBasemapRenderer({ layerRegistry: layers });
createRoot(root).render(<App basemapRenderer={renderer} />);
```

`kind: "base"` 的 Provider 互斥切换，`kind: "reference"` 的 Provider 可以独立
勾选；注册项必须声明归属信息和坐标系。若新图层不能合法叠加高德路线数据，应改用
新的 `BasemapRenderer` 和 Provider profile，而不是绕过合规边界。

页面发送的地点文本由服务端先走高德 POI 搜索，未命中时再用地理编码兜底。浏览器
定位值是 WGS‑84，只在用户点击“用当前位置”并随后生成路线时进入请求。

路线导出和地图 App 交接同样由 `RouteDeliveryRegistry` 注入。页面会自动显示
“路线 policy 允许且当前注册表已安装”的操作，新增格式或导航 Provider 不需要
修改 `App.tsx` 条件分支。

## 验证

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
```

浏览器验收覆盖默认成功流、三条路线切换、桌面布局、390 × 844 移动布局、
横向溢出和控制台错误。
