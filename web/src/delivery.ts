import { createAmapNavigationLink } from "../../src/adapters/amap/navigationLinkProvider.ts";
import {
  exportRouteGeoJson,
  exportRouteGpx,
  type RouteExport,
} from "../../src/route-delivery/exporters.ts";
import type { ApiRecommendedRoute } from "../../src/server-api/contracts.ts";
import {
  INITIAL_ROUTE_FORM,
  type RouteFormState,
} from "./model.ts";

function boundedNumber(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

export function routeFormFromSearch(
  search: string,
): RouteFormState {
  const parameters = new URLSearchParams(search);
  const mode =
    parameters.get("mode") === "cycling" ? "cycling" : "running";
  return {
    ...INITIAL_ROUTE_FORM,
    startQuery:
      parameters.get("start")?.trim() ||
      INITIAL_ROUTE_FORM.startQuery,
    mode,
    distanceKilometers: boundedNumber(
      parameters.get("distance"),
      INITIAL_ROUTE_FORM.distanceKilometers,
      1,
      mode === "cycling" ? 50 : 20,
    ),
    greenery: boundedNumber(
      parameters.get("greenery"),
      INITIAL_ROUTE_FORM.greenery,
      0,
      1,
    ),
    waterfront: boundedNumber(
      parameters.get("waterfront"),
      INITIAL_ROUTE_FORM.waterfront,
      0,
      1,
    ),
    lowTraffic: boundedNumber(
      parameters.get("lowTraffic"),
      INITIAL_ROUTE_FORM.lowTraffic,
      0,
      1,
    ),
  };
}

export function createRouteShareUrl(
  form: RouteFormState,
  currentUrl: string,
): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("start", form.startQuery.trim());
  url.searchParams.set("mode", form.mode);
  url.searchParams.set(
    "distance",
    String(form.distanceKilometers),
  );
  url.searchParams.set("greenery", String(form.greenery));
  url.searchParams.set("waterfront", String(form.waterfront));
  url.searchParams.set("lowTraffic", String(form.lowTraffic));
  return url.toString();
}

export function routeExport(
  route: ApiRecommendedRoute,
  format: "geojson" | "gpx",
): RouteExport {
  if (!route.delivery.exportFormats.includes(format)) {
    throw new Error("ROUTE_EXPORT_NOT_ALLOWED");
  }
  return format === "geojson"
    ? exportRouteGeoJson(route)
    : exportRouteGpx(route);
}

export function downloadRoute(
  route: ApiRecommendedRoute,
  format: "geojson" | "gpx",
): void {
  const exported = routeExport(route, format);
  const objectUrl = URL.createObjectURL(
    new Blob([exported.body], {
      type: exported.contentType,
    }),
  );
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `zhaolu-${route.id}.${exported.extension}`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function amapHandoffUrl(
  route: ApiRecommendedRoute,
  mode: RouteFormState["mode"],
): string {
  if (!route.delivery.navigationTargets.includes("amap")) {
    throw new Error("AMAP_HANDOFF_NOT_ALLOWED");
  }
  return createAmapNavigationLink(route, mode);
}
