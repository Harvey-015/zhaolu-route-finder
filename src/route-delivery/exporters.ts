import type { ApiRecommendedRoute } from "../server-api/contracts.ts";

export type RouteExport = Readonly<{
  contentType: string;
  extension: "geojson" | "gpx";
  body: string;
}>;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function routeName(route: ApiRecommendedRoute): string {
  return `找路 ${route.id}`;
}

export function exportRouteGeoJson(
  route: ApiRecommendedRoute,
): RouteExport {
  return {
    contentType: "application/geo+json; charset=utf-8",
    extension: "geojson",
    body: `${JSON.stringify(
      {
        type: "Feature",
        geometry: route.geometry,
        properties: {
          id: route.id,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          score: route.score.total,
          scorePolicy: `${route.score.policyId}@${route.score.policyVersion}`,
          provider: route.source.providerId,
        },
      },
      null,
      2,
    )}\n`,
  };
}

export function exportRouteGpx(
  route: ApiRecommendedRoute,
): RouteExport {
  const trackPoints = route.geometry.coordinates
    .map(
      ([longitude, latitude]) =>
        `      <trkpt lat="${latitude}" lon="${longitude}"></trkpt>`,
    )
    .join("\n");
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="zhaolu-route-finder"',
    '  xmlns="http://www.topografix.com/GPX/1/1"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1',
    '  https://www.topografix.com/GPX/1/1/gpx.xsd">',
    "  <metadata>",
    `    <name>${xmlEscape(routeName(route))}</name>`,
    "  </metadata>",
    "  <trk>",
    `    <name>${xmlEscape(routeName(route))}</name>`,
    "    <trkseg>",
    trackPoints,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
  return {
    contentType: "application/gpx+xml; charset=utf-8",
    extension: "gpx",
    body,
  };
}
