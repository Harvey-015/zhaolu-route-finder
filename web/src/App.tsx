import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  ApiRecommendedRoute,
  PlanRoutesApiRequest,
  PlanRoutesApiResponse,
} from "../../src/server-api/contracts.ts";
import type { SavedRouteSummary } from "../../src/user-data/models.ts";
import { planRoutes, RouteApiError } from "./api.ts";
import {
  amapHandoffUrl,
  createRouteShareUrl,
  downloadRoute,
  routeFormFromSearch,
} from "./delivery.ts";
import {
  buildPlanRequest,
  formatDistance,
  formatDuration,
  formatPercent,
  ROUTE_COLORS,
  routeDisplayName,
  type RouteFormState,
} from "./model.ts";
import { RouteMap } from "./RouteMap.tsx";
import {
  createAnonymousSession,
  deleteSavedRoute,
  listSavedRoutes,
  saveRoute,
  sendFieldReport,
  type AnonymousSession,
} from "./userDataApi.ts";

const SESSION_STORAGE_KEY = "zhaolu.anonymous-session.v1";

function storedSession(): AnonymousSession | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(SESSION_STORAGE_KEY) ?? "null",
    ) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { token?: unknown }).token === "string" &&
      typeof (value as { expiresAt?: unknown }).expiresAt ===
        "number" &&
      (value as { expiresAt: number }).expiresAt > Date.now()
    ) {
      return value as AnonymousSession;
    }
  } catch {
    // A malformed local value is treated as no session.
  }
  localStorage.removeItem(SESSION_STORAGE_KEY);
  return null;
}

function rememberSession(session: AnonymousSession): void {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
}

type SearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "success"; result: PlanRoutesApiResponse }>
  | Readonly<{
      status: "error";
      code: string;
      retryable: boolean;
      field?: string;
    }>;

const ERROR_LABELS: Readonly<Record<string, string>> = {
  INVALID_REQUEST: "搜索条件有误，请检查后重试。",
  PLACE_NOT_FOUND: "没有找到这个起点，请换一个更具体的地点。",
  PLACE_PROVIDER_UNAVAILABLE: "地点服务暂时不可用。",
  ROUTE_PROVIDER_TIMEOUT: "路线计算超时，请稍后重试。",
  ROUTE_PROVIDER_QUOTA_EXCEEDED: "今日路线服务额度已用完。",
  NO_SUITABLE_ROUTE: "暂时没有找到合适路线，请调整距离。",
  REQUEST_TIMEOUT: "本次搜索耗时过长，请稍后重试。",
  NETWORK_ERROR: "无法连接找路服务，请检查本地 API 是否启动。",
  INVALID_API_RESPONSE: "服务返回了无法识别的数据。",
  INTERNAL_ERROR: "服务暂时出现问题，请稍后重试。",
};

function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      className="brand-mark"
      viewBox="0 0 44 44"
    >
      <circle cx="22" cy="22" fill="#dfff64" r="20" />
      <path
        d="M12 28 C16 16 25 13 32 17 C26 19 22 22 20 31"
        fill="none"
        stroke="#12372f"
        strokeLinecap="round"
        strokeWidth="3.5"
      />
      <circle cx="12" cy="28" fill="#12372f" r="2.8" />
      <circle cx="20" cy="31" fill="#12372f" r="2.8" />
    </svg>
  );
}

function PreferenceSlider({
  label,
  detail,
  value,
  onChange,
}: Readonly<{
  label: string;
  detail: string;
  value: number;
  onChange: (value: number) => void;
}>) {
  return (
    <label className="preference-row">
      <span className="preference-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className="preference-control">
        <input
          aria-label={`${label}偏好`}
          max="1"
          min="0"
          onChange={(event) => onChange(Number(event.target.value))}
          step="0.1"
          type="range"
          value={value}
        />
        <output>{Math.round(value * 10)}</output>
      </span>
    </label>
  );
}

function Metric({
  label,
  value,
  inverse = false,
}: Readonly<{
  label: string;
  value: number | undefined;
  inverse?: boolean;
}>) {
  const normalized =
    value === undefined ? 0 : inverse ? 1 - value : value;
  return (
    <div className="metric">
      <div className="metric-heading">
        <span>{label}</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div className="metric-track" aria-hidden="true">
        <span style={{ width: `${normalized * 100}%` }} />
      </div>
    </div>
  );
}

function RouteCard({
  route,
  index,
  selected,
  onSelect,
}: Readonly<{
  route: ApiRecommendedRoute;
  index: number;
  selected: boolean;
  onSelect: () => void;
}>) {
  const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
  const green = route.scenicFeatures.greenCoverage?.value;
  const water = route.scenicFeatures.waterfrontProximity?.value;
  const built = route.scenicFeatures.builtUpExposure?.value;
  const reasonLabels = route.score.reasons
    .map(({ code }) => {
      if (code === "GREENERY") return "绿地较多";
      if (code === "WATERFRONT") return "亲近水岸";
      if (code === "DISTANCE_FIT") return "距离合适";
      return null;
    })
    .filter((label) => label !== null);

  return (
    <article
      className={selected ? "route-card selected" : "route-card"}
      style={{ "--route-color": color } as React.CSSProperties}
    >
      <button
        aria-pressed={selected}
        className="route-card-button"
        onClick={onSelect}
        type="button"
      >
        <span className="route-index">{String(index + 1).padStart(2, "0")}</span>
        <span className="route-card-main">
          <span className="route-card-title">
            <strong>{routeDisplayName(route, index)}</strong>
            <span className="route-score">
              {Math.round(route.score.total)}
              <small>分</small>
            </span>
          </span>
          <span className="route-summary">
            {formatDistance(route.distanceMeters)}
            <i />
            {formatDuration(route.durationSeconds)}
          </span>
        </span>
      </button>
      {selected ? (
        <div className="route-details">
          <div className="reason-list">
            {reasonLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
            {route.scenicFeatures.availability === "partial" ? (
              <span>部分环境数据</span>
            ) : null}
          </div>
          <Metric label="绿地覆盖" value={green} />
          <Metric label="水边接近" value={water} />
          <Metric label="建成区暴露" value={built} inverse />
          <p className="data-note">
            ESA WorldCover 提供环境特征；道路舒适度数据尚未接入。
          </p>
        </div>
      ) : null}
    </article>
  );
}

function ResultsPanel({
  state,
  selectedRouteId,
  onSelectRoute,
}: Readonly<{
  state: SearchState;
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
}>) {
  if (state.status === "idle") {
    return (
      <div className="result-empty">
        <span className="result-empty-number">03</span>
        <h2>最多三条，方向各不相同</h2>
        <p>
          找路会比较真实道路、目标距离和沿途环境，保留差异明显的候选。
        </p>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="loading-state" aria-live="polite">
        <span className="loading-orbit" />
        <p className="eyebrow">正在找路</p>
        <h2>规划真实道路并分析沿途环境</h2>
        <ol>
          <li>解析起点</li>
          <li>生成不同方向候选</li>
          <li>比较绿地与水岸</li>
        </ol>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="error-state" role="alert">
        <span className="error-code">{state.code}</span>
        <h2>{ERROR_LABELS[state.code] ?? "路线搜索失败。"}</h2>
        <p>
          {state.field
            ? `需要检查：${state.field}`
            : state.retryable
              ? "这是临时问题，可以再次尝试。"
              : "请调整输入条件后再次尝试。"}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="result-heading">
        <div>
          <p className="eyebrow">推荐结果</p>
          <h2>{state.result.routes.length} 条好路线</h2>
        </div>
        <span
          className={
            state.result.status === "complete"
              ? "result-status"
              : "result-status partial"
          }
        >
          {state.result.status === "complete" ? "完整" : "部分数据"}
        </span>
      </div>
      {state.result.warnings.length > 0 ? (
        <div className="warning-box">
          部分数据源暂不可用，路线仍可查看，评分置信度可能降低。
        </div>
      ) : null}
      <div className="route-list">
        {state.result.routes.map((route, index) => (
          <RouteCard
            index={index}
            key={route.id}
            onSelect={() => onSelectRoute(route.id)}
            route={route}
            selected={route.id === selectedRouteId}
          />
        ))}
      </div>
    </>
  );
}

function DeliveryPanel({
  route,
  mode,
  savedRoute,
  notice,
  onDownload,
  onSave,
  onShare,
  onAdjust,
  onFeedback,
}: Readonly<{
  route: ApiRecommendedRoute;
  mode: RouteFormState["mode"];
  savedRoute: SavedRouteSummary | null;
  notice: string | null;
  onDownload: (format: "geojson" | "gpx") => void;
  onSave: () => void;
  onShare: () => void;
  onAdjust: () => void;
  onFeedback: (rating: 1 | 2 | 3 | 4 | 5) => void;
}>) {
  const amapAllowed =
    route.delivery.navigationTargets.includes("amap");
  return (
    <section className="delivery-panel" aria-label="路线交付">
      <div className="delivery-heading">
        <div>
          <p className="eyebrow">带走这条路线</p>
          <h3>导出、收藏或继续规划</h3>
        </div>
        <span>{route.delivery.policyId}</span>
      </div>
      <div className="delivery-actions">
        {route.delivery.exportFormats.includes("gpx") ? (
          <button onClick={() => onDownload("gpx")} type="button">
            下载 GPX
          </button>
        ) : null}
        {route.delivery.exportFormats.includes("geojson") ? (
          <button
            onClick={() => onDownload("geojson")}
            type="button"
          >
            下载 GeoJSON
          </button>
        ) : null}
        {amapAllowed ? (
          <a
            href={amapHandoffUrl(route, mode)}
            rel="noreferrer"
            target="_blank"
          >
            高德到路线中点
          </a>
        ) : null}
        <button onClick={onShare} type="button">
          分享搜索条件
        </button>
        <button onClick={onAdjust} type="button">
          按此距离重算
        </button>
        <button
          disabled={
            route.delivery.persistence === "denied" ||
            savedRoute !== null
          }
          onClick={onSave}
          type="button"
        >
          {savedRoute ? "已收藏" : "收藏路线"}
        </button>
      </div>
      <p className="delivery-note">
        高德只能接收到起点和路线中点；完整自定义环线请使用 GPX。
        {route.delivery.persistence === "metadata-only"
          ? " 当前 Provider 只长期保存路线摘要，不保存几何。"
          : ""}
      </p>
      {savedRoute ? (
        <div className="feedback-row">
          <span>现场体验</span>
          {([1, 2, 3, 4, 5] as const).map((rating) => (
            <button
              aria-label={`提交 ${rating} 分现场体验`}
              key={rating}
              onClick={() => onFeedback(rating)}
              type="button"
            >
              {rating}
            </button>
          ))}
        </div>
      ) : null}
      {notice ? (
        <p className="delivery-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function SavedRoutesPanel({
  routes,
  onDelete,
}: Readonly<{
  routes: readonly SavedRouteSummary[];
  onDelete: (routeId: string) => void;
}>) {
  if (routes.length === 0) return null;
  return (
    <section className="saved-routes" aria-label="已收藏路线">
      <div className="saved-routes-heading">
        <p className="eyebrow">设备收藏</p>
        <span>{routes.length} 条</span>
      </div>
      {routes.map((route) => (
        <div className="saved-route-row" key={route.id}>
          <span>
            <strong>{route.name}</strong>
            <small>
              {formatDistance(route.distanceMeters)} ·{" "}
              {Math.round(route.score)} 分
              {route.hasGeometry ? " · 含几何" : " · 仅摘要"}
            </small>
          </span>
          <button
            aria-label={`删除收藏 ${route.name}`}
            onClick={() => onDelete(route.id)}
            type="button"
          >
            删除
          </button>
        </div>
      ))}
    </section>
  );
}

export function App() {
  const [form, setForm] = useState<RouteFormState>(() =>
    routeFormFromSearch(window.location.search),
  );
  const [search, setSearch] = useState<SearchState>({
    status: "idle",
  });
  const [selectedRouteId, setSelectedRouteId] =
    useState<string | null>(null);
  const [lastRequest, setLastRequest] =
    useState<PlanRoutesApiRequest | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<
    readonly SavedRouteSummary[]
  >([]);
  const [savedByResultRoute, setSavedByResultRoute] = useState<
    Readonly<Record<string, SavedRouteSummary>>
  >({});
  const [deliveryNotice, setDeliveryNotice] =
    useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const session = storedSession();
    if (session) {
      void listSavedRoutes(session.token)
        .then(setSavedRoutes)
        .catch((error: unknown) => {
          if (
            error instanceof RouteApiError &&
            error.status === 401
          ) {
            localStorage.removeItem(SESSION_STORAGE_KEY);
          }
        });
    }
    return () => {
      activeRequest.current?.abort();
    };
  }, []);

  const updateForm = <Key extends keyof RouteFormState>(
    key: Key,
    value: RouteFormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.startQuery.trim()) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSearch({ status: "loading" });
    setSelectedRouteId(null);
    setSavedByResultRoute({});
    setDeliveryNotice(null);
    const requestId = `web-${crypto.randomUUID()}`;
    const request = buildPlanRequest(form, requestId);
    setLastRequest(request);

    try {
      const result = await planRoutes(
        request,
        controller.signal,
      );
      if (activeRequest.current !== controller) return;
      setSearch({ status: "success", result });
      setSelectedRouteId(result.routes[0]?.id ?? null);
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        return;
      }
      if (activeRequest.current !== controller) return;
      if (error instanceof RouteApiError) {
        setSearch({
          status: "error",
          code: error.code,
          retryable: error.retryable,
          field:
            typeof error.details?.field === "string"
              ? error.details.field
              : undefined,
        });
      } else {
        setSearch({
          status: "error",
          code: "INTERNAL_ERROR",
          retryable: false,
        });
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  };

  const routes =
    search.status === "success" ? search.result.routes : [];
  const selectedRoute =
    routes.find(({ id }) => id === selectedRouteId) ?? null;
  const selectedSavedRoute =
    selectedRoute === null
      ? null
      : savedByResultRoute[selectedRoute.id] ?? null;

  const sessionToken = async (): Promise<string> => {
    const current = storedSession();
    if (current) return current.token;
    const created = await createAnonymousSession();
    rememberSession(created);
    return created.token;
  };

  const saveSelectedRoute = async () => {
    if (!selectedRoute || !lastRequest) return;
    setDeliveryNotice("正在收藏…");
    try {
      const token = await sessionToken();
      const saved = await saveRoute(token, {
        name: routeDisplayName(
          selectedRoute,
          routes.indexOf(selectedRoute),
        ),
        request: lastRequest,
        route: selectedRoute,
      });
      setSavedRoutes((current) => [
        saved,
        ...current.filter(({ id }) => id !== saved.id),
      ]);
      setSavedByResultRoute((current) => ({
        ...current,
        [selectedRoute.id]: saved,
      }));
      setDeliveryNotice(
        saved.hasGeometry
          ? "路线已收藏，包含可恢复的几何。"
          : "路线摘要已收藏；Provider policy 禁止长期保存几何。",
      );
    } catch (error) {
      setDeliveryNotice(
        error instanceof RouteApiError
          ? `收藏失败：${error.code}`
          : "收藏失败，请稍后重试。",
      );
    }
  };

  const shareSearch = async () => {
    const url = createRouteShareUrl(form, window.location.href);
    try {
      if (navigator.share) {
        await navigator.share({
          title: "找路 · 风景路线条件",
          text: "用这组条件生成风景路线",
          url,
        });
        setDeliveryNotice("搜索条件已分享。");
      } else {
        await navigator.clipboard.writeText(url);
        setDeliveryNotice("搜索条件链接已复制。");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setDeliveryNotice("暂时无法分享，请复制浏览器地址。");
    }
  };

  const removeSavedRoute = async (routeId: string) => {
    const session = storedSession();
    if (!session) return;
    try {
      await deleteSavedRoute(session.token, routeId);
      setSavedRoutes((current) =>
        current.filter(({ id }) => id !== routeId),
      );
      setSavedByResultRoute((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, value]) => value.id !== routeId,
          ),
        ),
      );
      setDeliveryNotice("收藏已删除。");
    } catch (error) {
      setDeliveryNotice(
        error instanceof RouteApiError
          ? `删除失败：${error.code}`
          : "删除失败，请稍后重试。",
      );
    }
  };

  const reportSelectedRoute = async (
    rating: 1 | 2 | 3 | 4 | 5,
  ) => {
    if (!selectedSavedRoute) return;
    const session = storedSession();
    if (!session) return;
    try {
      await sendFieldReport(
        session.token,
        selectedSavedRoute.id,
        rating,
      );
      setDeliveryNotice(`已提交 ${rating} 分现场体验，谢谢。`);
    } catch (error) {
      setDeliveryNotice(
        error instanceof RouteApiError
          ? `反馈失败：${error.code}`
          : "反馈失败，请稍后重试。",
      );
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="找路首页">
          <BrandMark />
          <span>
            <strong>找路</strong>
            <small>SCENIC ROUTE FINDER</small>
          </span>
        </a>
        <div className="topbar-copy">
          <span>跑步</span>
          <i />
          <span>骑行</span>
          <i />
          <span>风景优先</span>
        </div>
        <div className="api-badge">
          <span />
          API v1 · 收藏 {savedRoutes.length}
        </div>
      </header>

      <main className="workspace">
        <aside className="control-panel">
          <div className="panel-intro">
            <p className="eyebrow">规划条件</p>
            <h1>今天，想往哪边走？</h1>
            <p>
              选择运动方式、距离与环境偏好，我们会寻找真实可通行的风景路线。
            </p>
          </div>

          <form onSubmit={submit}>
            <label className="field-label" htmlFor="start-query">
              起点
            </label>
            <div className="location-field">
              <span className="location-dot" />
              <input
                autoComplete="off"
                id="start-query"
                maxLength={200}
                onChange={(event) =>
                  updateForm("startQuery", event.target.value)
                }
                placeholder="地点、地标或地址"
                required
                value={form.startQuery}
              />
              <span className="location-crs">WGS84</span>
            </div>

            <fieldset className="mode-fieldset">
              <legend>运动方式</legend>
              <div className="mode-switch">
                <button
                  aria-pressed={form.mode === "running"}
                  className={
                    form.mode === "running" ? "active" : ""
                  }
                  onClick={() => updateForm("mode", "running")}
                  type="button"
                >
                  <span>RUN</span>
                  跑步
                </button>
                <button
                  aria-pressed={form.mode === "cycling"}
                  className={
                    form.mode === "cycling" ? "active" : ""
                  }
                  onClick={() => updateForm("mode", "cycling")}
                  type="button"
                >
                  <span>RIDE</span>
                  骑行
                </button>
              </div>
            </fieldset>

            <div className="distance-heading">
              <label htmlFor="distance">目标距离</label>
              <output>{form.distanceKilometers} km</output>
            </div>
            <input
              className="distance-slider"
              id="distance"
              max={form.mode === "cycling" ? 50 : 20}
              min="1"
              onChange={(event) =>
                updateForm(
                  "distanceKilometers",
                  Number(event.target.value),
                )
              }
              step="1"
              type="range"
              value={form.distanceKilometers}
            />
            <div className="distance-presets">
              {(form.mode === "cycling"
                ? [10, 20, 30, 50]
                : [3, 5, 8, 12]
              ).map((distance) => (
                <button
                  className={
                    form.distanceKilometers === distance
                      ? "active"
                      : ""
                  }
                  key={distance}
                  onClick={() =>
                    updateForm("distanceKilometers", distance)
                  }
                  type="button"
                >
                  {distance} km
                </button>
              ))}
            </div>

            <div className="preference-heading">
              <div>
                <label>环境偏好</label>
                <p>0 不关注 · 10 非常重要</p>
              </div>
              <span>可组合</span>
            </div>
            <div className="preference-list">
              <PreferenceSlider
                detail="树木、草地与湿地"
                label="更多绿意"
                onChange={(value) => updateForm("greenery", value)}
                value={form.greenery}
              />
              <PreferenceSlider
                detail="湖岸、河道与湿地"
                label="靠近水边"
                onChange={(value) =>
                  updateForm("waterfront", value)
                }
                value={form.waterfront}
              />
              <PreferenceSlider
                detail="减少高建成区暴露"
                label="远离密集城区"
                onChange={(value) =>
                  updateForm("lowTraffic", value)
                }
                value={form.lowTraffic}
              />
            </div>

            <button
              className="submit-button"
              disabled={
                search.status === "loading" ||
                !form.startQuery.trim()
              }
              type="submit"
            >
              <span>
                {search.status === "loading"
                  ? "正在生成路线"
                  : "生成风景路线"}
              </span>
              <span aria-hidden="true">↗</span>
            </button>
            <p className="form-footnote">
              最多生成 {form.maxResults} 条差异路线 · 收藏遵循 Provider policy
            </p>
          </form>
        </aside>

        <section className="map-panel">
          <RouteMap
            onSelectRoute={setSelectedRouteId}
            routes={routes}
            selectedRouteId={selectedRouteId}
          />
        </section>

        <aside className="results-panel" aria-live="polite">
          <ResultsPanel
            onSelectRoute={setSelectedRouteId}
            selectedRouteId={selectedRouteId}
            state={search}
          />
          {selectedRoute ? (
            <DeliveryPanel
              mode={form.mode}
              notice={deliveryNotice}
              onAdjust={() => {
                updateForm(
                  "distanceKilometers",
                  Math.max(
                    1,
                    Math.round(
                      selectedRoute.distanceMeters / 1_000,
                    ),
                  ),
                );
                setDeliveryNotice(
                  "目标距离已更新，可调整偏好后重新生成。",
                );
              }}
              onDownload={(format) => {
                try {
                  downloadRoute(selectedRoute, format);
                  setDeliveryNotice(
                    `${format.toUpperCase()} 已开始下载。`,
                  );
                } catch {
                  setDeliveryNotice("当前路线不允许这种导出。");
                }
              }}
              onFeedback={(rating) => {
                void reportSelectedRoute(rating);
              }}
              onSave={() => {
                void saveSelectedRoute();
              }}
              onShare={() => {
                void shareSearch();
              }}
              route={selectedRoute}
              savedRoute={selectedSavedRoute}
            />
          ) : null}
          <SavedRoutesPanel
            onDelete={(routeId) => {
              void removeSavedRoute(routeId);
            }}
            routes={savedRoutes}
          />
        </aside>
      </main>

      <footer>
        <span>找路 · Provider-neutral route core</span>
        <span>WGS84 · GeoJSON · ESA WorldCover 2021</span>
      </footer>
    </div>
  );
}
