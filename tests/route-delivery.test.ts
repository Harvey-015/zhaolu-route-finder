import assert from "node:assert/strict";
import test from "node:test";

import { createAmapNavigationLink } from "../src/adapters/amap/navigationLinkProvider.ts";
import {
  exportRouteGeoJson,
  exportRouteGpx,
} from "../src/route-delivery/exporters.ts";
import {
  resolveFixtureRouteDeliveryPolicy,
  resolveRouteDeliveryPolicy,
} from "../src/route-delivery/policy.ts";
import { DELIVERY_TEST_ROUTE } from "./fixtures/delivery.ts";

test("exports a route as a stable GeoJSON feature", () => {
  const exported = exportRouteGeoJson(DELIVERY_TEST_ROUTE);
  const feature = JSON.parse(exported.body) as {
    type: string;
    geometry: { coordinates: unknown };
    properties: { provider: string; score: number };
  };

  assert.equal(exported.extension, "geojson");
  assert.equal(exported.contentType, "application/geo+json; charset=utf-8");
  assert.equal(feature.type, "Feature");
  assert.deepEqual(
    feature.geometry.coordinates,
    DELIVERY_TEST_ROUTE.geometry.coordinates,
  );
  assert.equal(feature.properties.provider, "fake-route");
  assert.equal(feature.properties.score, 82.5);
});

test("exports every WGS-84 point as a GPX track", () => {
  const exported = exportRouteGpx(DELIVERY_TEST_ROUTE);

  assert.equal(exported.extension, "gpx");
  assert.match(exported.body, /<gpx version="1\.1"/);
  assert.match(
    exported.body,
    /<trkpt lat="30\.244" lon="120\.148">/,
  );
  assert.equal(
    (exported.body.match(/<trkpt /g) ?? []).length,
    3,
  );
});

test("creates an AMap handoff to the route midpoint in GCJ-02", () => {
  const link = createAmapNavigationLink(
    DELIVERY_TEST_ROUTE,
    "cycling",
  );
  const url = new URL(link);

  assert.equal(url.origin, "https://uri.amap.com");
  assert.equal(url.pathname, "/navigation");
  assert.equal(url.searchParams.get("mode"), "ride");
  assert.equal(url.searchParams.get("callnative"), "1");
  assert.match(url.searchParams.get("from") ?? "", /找路起点/);
  assert.match(url.searchParams.get("to") ?? "", /路线中点/);
  assert.notEqual(
    url.searchParams.get("from")?.split(",", 2).join(","),
    "120.148000,30.244000",
  );
});

test("uses explicit Provider policy and denies unknown sources", () => {
  assert.equal(
    resolveFixtureRouteDeliveryPolicy("fake-route").persistence,
    "allowed",
  );
  assert.equal(
    resolveRouteDeliveryPolicy("amap-route").persistence,
    "metadata-only",
  );
  assert.deepEqual(
    resolveRouteDeliveryPolicy("unknown-provider").exportFormats,
    [],
  );
  assert.equal(
    resolveRouteDeliveryPolicy("unknown-provider").persistence,
    "denied",
  );
});
