import type { TravelMode } from "../../route-recommendation/models.ts";
import type { ApiRecommendedRoute } from "../../server-api/contracts.ts";
import type { NavigationLinkProvider } from "../../route-delivery/ports.ts";
import { wgs84Point } from "../../route-recommendation/coordinates.ts";
import { wgs84ToGcj02 } from "./coordinates.ts";

function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

export function createAmapNavigationLink(
  route: ApiRecommendedRoute,
  mode: TravelMode,
  source = "zhaolu-route-finder",
): string {
  if (route.geometry.coordinates.length < 2) {
    throw new RangeError("ROUTE_GEOMETRY_TOO_SHORT");
  }
  const start = route.geometry.coordinates[0];
  const destination =
    route.geometry.coordinates[
      Math.floor(route.geometry.coordinates.length / 2)
    ];
  const startGcj = wgs84ToGcj02(wgs84Point(start[0], start[1]));
  const destinationGcj = wgs84ToGcj02(
    wgs84Point(destination[0], destination[1]),
  );
  const url = new URL("https://uri.amap.com/navigation");
  url.searchParams.set(
    "from",
    `${formatCoordinate(startGcj.longitude)},${formatCoordinate(startGcj.latitude)},找路起点`,
  );
  url.searchParams.set(
    "to",
    `${formatCoordinate(destinationGcj.longitude)},${formatCoordinate(destinationGcj.latitude)},路线中点`,
  );
  url.searchParams.set("mode", mode === "cycling" ? "ride" : "walk");
  url.searchParams.set("src", source);
  url.searchParams.set("callnative", "1");
  return url.toString();
}

export const amapNavigationLinkProvider: NavigationLinkProvider =
  Object.freeze({
    target: "amap",
    label: "高德到路线中点",
    createLink: (route, context) =>
      createAmapNavigationLink(route, context.mode),
  } satisfies NavigationLinkProvider);
