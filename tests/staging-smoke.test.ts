import assert from "node:assert/strict";
import test from "node:test";
import { runStagingSmoke } from "../scripts/smoke-staging.ts";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function stagingFetcher(
  options: Readonly<{
    hsts?: boolean;
    routeExports?: readonly string[];
  }> = {},
) {
  const paths: string[] = [];
  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/v1/health") {
      return json({ status: "ok" });
    }
    if (url.pathname === "/api/v1/ready") {
      return json({ status: "ready" });
    }
    if (url.pathname === "/api/v1/capabilities") {
      return json({
        coordinateReferenceSystem: "WGS84",
        geometryFormat: "GeoJSON",
        webMap: { available: true },
      });
    }
    if (url.pathname === "/api/v1/map-config") {
      return json({
        enabled: true,
        providerId: "amap-jsapi",
        key: "public-browser-key",
        serviceHost: "/_AMapService",
      });
    }
    if (url.pathname === "/api/v1/legal-config") {
      return json({
        documentVersion: "2026-08-01",
        configured: true,
        operatorName: "找路测试运营者",
        privacyContact: "privacy@example.test",
        logRetentionDays: 30,
      });
    }
    if (url.pathname === "/api/v1/openapi.json") {
      return json({
        openapi: "3.1.0",
        paths: {
          "/api/v1/routes/plan": {},
          "/api/v1/map-config": {},
          "/api/v1/legal-config": {},
        },
      });
    }
    if (url.pathname === "/") {
      return new Response("<!doctype html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "default-src 'self'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          ...(options.hsts === false
            ? {}
            : { "strict-transport-security": "max-age=31536000" }),
        },
      });
    }
    if (url.pathname === "/api/v1/routes/plan") {
      const request = JSON.parse(String(init?.body)) as {
        requestId: string;
      };
      return json({
        schemaVersion: "1",
        requestId: request.requestId,
        status: "complete",
        routes: [
          {
            source: { providerId: "amap-route" },
            geometry: {
              type: "LineString",
              coordinates: [
                [120.14, 30.26],
                [120.15, 30.27],
              ],
            },
            delivery: {
              persistence: "metadata-only",
              navigationTargets: ["amap"],
              exportFormats: options.routeExports ?? [],
            },
          },
        ],
      });
    }
    return new Response(null, { status: 404 });
  };
  return { fetcher, paths };
}

test("validates staging edge, contracts, map config, and one live route", async () => {
  const fixture = stagingFetcher();
  const result = await runStagingSmoke({
    environment: {
      STAGING_BASE_URL: "https://staging.routes.example.com",
    },
    fetcher: fixture.fetcher,
  });

  assert.equal(result.status, "passed");
  assert.equal(result.requestCount, 8);
  assert.deepEqual(fixture.paths, [
    "GET /api/v1/health",
    "GET /api/v1/ready",
    "GET /api/v1/capabilities",
    "GET /api/v1/map-config",
    "GET /api/v1/legal-config",
    "GET /api/v1/openapi.json",
    "GET /",
    "POST /api/v1/routes/plan",
  ]);
});

test("fails closed for non-HTTPS staging and missing edge HSTS", async () => {
  let called = false;
  const invalidOrigin = await runStagingSmoke({
    environment: { STAGING_BASE_URL: "http://staging.example.com" },
    fetcher: async () => {
      called = true;
      return new Response();
    },
  });
  assert.equal(invalidOrigin.status, "failed");
  assert.equal(invalidOrigin.code, "STAGING_CONFIGURATION_INVALID");
  assert.equal(called, false);

  const noHsts = stagingFetcher({ hsts: false });
  const missingHsts = await runStagingSmoke({
    environment: {
      STAGING_BASE_URL: "https://staging.routes.example.com",
    },
    fetcher: noHsts.fetcher,
  });
  assert.equal(missingHsts.status, "failed");
  assert.equal(missingHsts.code, "STAGING_WEB_SECURITY_INVALID");
  assert.equal(missingHsts.requestCount, 7);
});

test("checks the explicitly expected AMap export policy", async () => {
  const fixture = stagingFetcher({
    routeExports: ["geojson", "gpx"],
  });
  const result = await runStagingSmoke({
    environment: {
      STAGING_BASE_URL: "https://staging.routes.example.com",
      STAGING_EXPECT_ROUTE_EXPORTS: "true",
    },
    fetcher: fixture.fetcher,
  });

  assert.equal(result.status, "passed");
  if (result.status === "passed") {
    assert.equal(result.routeExportsAllowed, true);
  }
});
