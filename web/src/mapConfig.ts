import type { RouteApiFetch } from "./api.ts";

export type WebMapConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      providerId: "amap-jsapi";
      key: string;
      serviceHost: "/_AMapService";
    }>;

export async function loadWebMapConfig(
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<WebMapConfig> {
  const response = await fetcher("/api/v1/map-config", {
    method: "GET",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return { enabled: false };

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return { enabled: false };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { enabled: false };
  }
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== "1" || config.enabled !== true) {
    return { enabled: false };
  }
  if (
    config.providerId !== "amap-jsapi" ||
    typeof config.key !== "string" ||
    !config.key.trim() ||
    config.serviceHost !== "/_AMapService"
  ) {
    return { enabled: false };
  }
  return {
    enabled: true,
    providerId: "amap-jsapi",
    key: config.key,
    serviceHost: "/_AMapService",
  };
}
