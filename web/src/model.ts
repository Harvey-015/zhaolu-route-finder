import type {
  ApiRecommendedRoute,
  PlanRoutesApiRequest,
} from "../../src/server-api/contracts.ts";

export type RouteFormState = Readonly<{
  startQuery: string;
  startPoint: Readonly<{
    longitude: number;
    latitude: number;
  }> | null;
  requiredStops: readonly string[];
  mode: "running" | "cycling";
  distanceKilometers: number;
  greenery: number;
  waterfront: number;
  lowTraffic: number;
  maxResults: number;
}>;

export const INITIAL_ROUTE_FORM: RouteFormState = {
  startQuery: "杭州西湖",
  startPoint: null,
  requiredStops: [],
  mode: "running",
  distanceKilometers: 5,
  greenery: 0.9,
  waterfront: 0.8,
  lowTraffic: 0.7,
  maxResults: 3,
};

export function clampDistanceKilometers(
  mode: RouteFormState["mode"],
  distanceKilometers: number,
): number {
  const maximum = mode === "cycling" ? 50 : 20;
  if (!Number.isFinite(distanceKilometers)) return 1;
  return Math.max(1, Math.min(maximum, distanceKilometers));
}

export function buildPlanRequest(
  form: RouteFormState,
  requestId: string,
): PlanRoutesApiRequest {
  return {
    schemaVersion: "1",
    requestId,
    start: form.startPoint
      ? {
          kind: "point",
          longitude: form.startPoint.longitude,
          latitude: form.startPoint.latitude,
          crs: "WGS84",
          label: form.startQuery.trim() || "我的当前位置",
        }
      : {
          kind: "query",
          query: form.startQuery.trim(),
        },
    mode: form.mode,
    targetDistanceMeters: Math.round(
      clampDistanceKilometers(
        form.mode,
        form.distanceKilometers,
      ) * 1_000,
    ),
    preferences: {
      greenery: form.greenery,
      waterfront: form.waterfront,
      lowTraffic: form.lowTraffic,
      comfort: 0,
    },
    ...(form.requiredStops.length > 0
      ? {
          requiredStops: form.requiredStops.map((query) => ({
            kind: "query" as const,
            query: query.trim(),
          })),
        }
      : {}),
    maxResults: form.maxResults,
  };
}

export function formatDistance(distanceMeters: number): string {
  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}

export function formatDuration(
  durationSeconds: number | null,
): string {
  if (durationSeconds === null) return "时间未知";
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? `${hours} 小时`
    : `${hours} 小时 ${remainder} 分`;
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined) return "暂无";
  return `${Math.round(value * 100)}%`;
}

export function routeDisplayName(
  route: ApiRecommendedRoute,
  index: number,
): string {
  const direction = ((route.directionDegrees % 360) + 360) % 360;
  const directionLabel =
    direction < 22.5 || direction >= 337.5
      ? "北向"
      : direction < 67.5
        ? "东北向"
        : direction < 112.5
          ? "东向"
          : direction < 157.5
            ? "东南向"
            : direction < 202.5
              ? "南向"
              : direction < 247.5
                ? "西南向"
                : direction < 292.5
                  ? "西向"
                  : "西北向";
  return `${directionLabel}路线 ${String(index + 1).padStart(2, "0")}`;
}

export const ROUTE_COLORS = [
  "#dfff64",
  "#ff8b5b",
  "#66b7ff",
  "#e5a8ff",
  "#ffd166",
] as const;
