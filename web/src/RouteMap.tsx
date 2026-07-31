import type { ApiRecommendedRoute } from "../../src/server-api/contracts.ts";
import {
  ROUTE_COLORS,
  routeDisplayName,
} from "./model.ts";
import {
  defineBasemapRenderer,
  type BasemapViewportProps,
} from "./basemap.ts";

type ProjectedPoint = Readonly<{ x: number; y: number }>;

const WIDTH = 920;
const HEIGHT = 640;
const PADDING = 92;

function pathData(points: readonly ProjectedPoint[]): string {
  return points
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join(" ");
}

function projectedRoutes(routes: readonly ApiRecommendedRoute[]) {
  const coordinates = routes.flatMap(
    ({ geometry }) => geometry.coordinates,
  );
  if (coordinates.length === 0) return [];
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.0001);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.0001);
  const availableWidth = WIDTH - PADDING * 2;
  const availableHeight = HEIGHT - PADDING * 2;

  return routes.map((route) => ({
    route,
    points: route.geometry.coordinates.map(
      ([longitude, latitude]) => ({
        x:
          PADDING +
          ((longitude - minLongitude) / longitudeSpan) *
            availableWidth,
        y:
          PADDING +
          ((maxLatitude - latitude) / latitudeSpan) *
            availableHeight,
      }),
    ),
  }));
}

function EmptyMap() {
  return (
    <div className="map-empty">
      <svg
        aria-hidden="true"
        className="empty-route-illustration"
        viewBox="0 0 360 220"
      >
        <path
          d="M48 168 C96 92 118 66 178 86 C240 106 278 72 314 38"
          fill="none"
          stroke="currentColor"
          strokeDasharray="5 10"
          strokeLinecap="round"
          strokeWidth="6"
        />
        <circle cx="48" cy="168" fill="#dfff64" r="12" />
        <circle cx="314" cy="38" fill="#ff8b5b" r="10" />
        <path
          d="M168 86 C184 58 215 48 241 62"
          fill="none"
          stroke="#66b7ff"
          strokeLinecap="round"
          strokeWidth="5"
        />
      </svg>
      <p className="eyebrow">路线几何预览</p>
      <h2>从一个想去的方向开始</h2>
      <p>
        设置距离与环境偏好，找路会生成多条真实可通行路线，并比较沿途环境。
      </p>
    </div>
  );
}

export function RouteMap({
  routes,
  selectedRouteId,
  onSelectRoute,
}: BasemapViewportProps) {
  if (routes.length === 0) return <EmptyMap />;
  const projected = projectedRoutes(routes);
  const selected =
    projected.find(({ route }) => route.id === selectedRouteId) ??
    projected[0];
  const startPoint = selected.points[0];

  return (
    <div className="route-map-wrap">
      <div className="map-caption">
        <div>
          <p className="eyebrow">GeoJSON 路线预览</p>
          <strong>多方向路线对比</strong>
        </div>
        <span className="map-note">底图待 Web Key 接入</span>
      </div>
      <svg
        aria-label="路线几何预览图"
        className="route-map"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <rect
          className="map-background"
          height={HEIGHT}
          rx="22"
          width={WIDTH}
        />
        {Array.from({ length: 8 }, (_, index) => (
          <line
            className="map-grid-line"
            key={`vertical-${index}`}
            x1={80 + index * 110}
            x2={80 + index * 110}
            y1="42"
            y2={HEIGHT - 42}
          />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <line
            className="map-grid-line"
            key={`horizontal-${index}`}
            x1="42"
            x2={WIDTH - 42}
            y1={70 + index * 100}
            y2={70 + index * 100}
          />
        ))}
        <path
          className="map-water-mark"
          d="M-20 500 C160 420 245 505 370 468 C510 426 618 338 940 402"
        />
        {projected.map(({ route, points }, index) => {
          const isSelected = route.id === selected.route.id;
          const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
          return (
            <g key={route.id}>
              <path
                className="route-shadow"
                d={pathData(points)}
                opacity={isSelected ? 0.9 : 0.32}
                strokeWidth={isSelected ? 18 : 12}
              />
              <path
                aria-label={routeDisplayName(route, index)}
                className={`route-line ${isSelected ? "selected" : ""}`}
                d={pathData(points)}
                onClick={() => onSelectRoute(route.id)}
                role="button"
                stroke={color}
                strokeWidth={isSelected ? 9 : 6}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelectRoute(route.id);
                  }
                }}
              />
            </g>
          );
        })}
        {startPoint ? (
          <g transform={`translate(${startPoint.x} ${startPoint.y})`}>
            <circle className="start-halo" r="22" />
            <circle className="start-marker" r="10" />
            <path
              className="start-flag"
              d="M0 -10 L0 -34 L24 -27 L0 -20"
            />
          </g>
        ) : null}
      </svg>
      <div className="map-legend" aria-label="路线图例">
        {routes.map((route, index) => (
          <button
            className={
              route.id === selected.route.id
                ? "legend-item active"
                : "legend-item"
            }
            key={route.id}
            onClick={() => onSelectRoute(route.id)}
            type="button"
          >
            <span
              className="legend-swatch"
              style={{
                backgroundColor:
                  ROUTE_COLORS[index % ROUTE_COLORS.length],
              }}
            />
            {routeDisplayName(route, index)}
          </button>
        ))}
      </div>
    </div>
  );
}

export const svgBasemapRenderer = defineBasemapRenderer({
  id: "svg-preview",
  displayName: "SVG 路线预览",
  component: RouteMap,
});
