import assert from "node:assert/strict";
import test from "node:test";

import {
  planRoutes,
  RouteApiError,
  type RouteApiFetch,
} from "../web/src/api.ts";
import {
  buildPlanRequest,
  clampDistanceKilometers,
  type RouteFormState,
} from "../web/src/model.ts";
import {
  createRouteShareUrl,
  routeExport,
  routeFormFromSearch,
} from "../web/src/delivery.ts";
import {
  BasemapRendererRegistry,
  defineBasemapRenderer,
} from "../web/src/basemap.ts";
import {
  defineMapLayerProvider,
  MapLayerProviderRegistry,
} from "../web/src/mapLayers.ts";
import {
  amapSatelliteLayerProvider,
  amapStandardLayerProvider,
  defaultAmapMapLayerRegistry,
  type AmapNamespace,
} from "../web/src/amapLayers.ts";
import { loadWebMapConfig } from "../web/src/mapConfig.ts";
import {
  createAnonymousSession,
  createAnonymousSessionCoordinator,
  deleteAllUserData,
  saveRoute,
} from "../web/src/userDataApi.ts";
import { loadLegalConfig } from "../web/src/legal.ts";
import type {
  PlanRoutesApiRequest,
  PlanRoutesApiResponse,
} from "../src/server-api/contracts.ts";
import { RouteDeliveryRegistry } from "../src/route-delivery/registry.ts";
import { DELIVERY_TEST_ROUTE } from "./fixtures/delivery.ts";

const FORM: RouteFormState = {
  startQuery: "  杭州西湖  ",
  startPoint: null,
  requiredStops: [],
  mode: "cycling",
  distanceKilometers: 8.25,
  greenery: 0.8,
  waterfront: 0.6,
  lowTraffic: 0.4,
  maxResults: 2,
};

const REQUEST: PlanRoutesApiRequest = buildPlanRequest(
  FORM,
  "web-test-1",
);

const SUCCESS_RESPONSE: PlanRoutesApiResponse = {
  schemaVersion: "1",
  requestId: "web-test-1",
  status: "complete",
  start: {
    id: "place-1",
    name: "杭州西湖",
    point: {
      type: "Point",
      coordinates: [120.148, 30.244],
    },
    source: {
      providerId: "fixture",
    },
  },
  requiredStops: [],
  routes: [],
  warnings: [],
  diagnostics: {
    generatedCandidateCount: 0,
    routedCandidateCount: 0,
    selectedRouteCount: 0,
    sceneryDegraded: false,
    degradedSceneryRouteIds: [],
  },
};

test("buildPlanRequest normalizes form values for the API", () => {
  assert.deepEqual(REQUEST, {
    schemaVersion: "1",
    requestId: "web-test-1",
    start: {
      kind: "query",
      query: "杭州西湖",
    },
    mode: "cycling",
    targetDistanceMeters: 8_250,
    preferences: {
      greenery: 0.8,
      waterfront: 0.6,
      lowTraffic: 0.4,
      comfort: 0,
    },
    maxResults: 2,
  });
});

test("buildPlanRequest accepts a browser WGS84 point and required stops", () => {
  assert.deepEqual(
    buildPlanRequest(
      {
        ...FORM,
        startQuery: "我的当前位置",
        startPoint: { longitude: 120.15, latitude: 30.25 },
        requiredStops: ["太子湾公园", "杭州植物园"],
      },
      "web-point-1",
    ),
    {
      schemaVersion: "1",
      requestId: "web-point-1",
      start: {
        kind: "point",
        longitude: 120.15,
        latitude: 30.25,
        crs: "WGS84",
        label: "我的当前位置",
      },
      mode: "cycling",
      targetDistanceMeters: 8_250,
      preferences: {
        greenery: 0.8,
        waterfront: 0.6,
        lowTraffic: 0.4,
        comfort: 0,
      },
      requiredStops: [
        { kind: "query", query: "太子湾公园" },
        { kind: "query", query: "杭州植物园" },
      ],
      maxResults: 2,
    },
  );
});

test("distance limits stay consistent when switching activity mode", () => {
  assert.equal(clampDistanceKilometers("running", 50), 20);
  assert.equal(clampDistanceKilometers("cycling", 50), 50);
  assert.equal(clampDistanceKilometers("running", 0), 1);
  assert.equal(clampDistanceKilometers("cycling", 8.25), 8.25);
});

test("planRoutes sends the stable API contract and returns a valid response", async () => {
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;
  const fetcher: RouteApiFetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return Response.json(SUCCESS_RESPONSE);
  };

  const response = await planRoutes(REQUEST, undefined, fetcher);

  assert.deepEqual(response, SUCCESS_RESPONSE);
  assert.equal(capturedInput, "/api/v1/routes/plan");
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(
    JSON.parse(String(capturedInit?.body)),
    REQUEST,
  );
  assert.deepEqual(capturedInit?.headers, {
    accept: "application/json",
    "content-type": "application/json",
    "x-request-id": "web-test-1",
  });
});

test("planRoutes preserves a stable server error without leaking messages", async () => {
  const fetcher: RouteApiFetch = async () =>
    Response.json(
      {
        schemaVersion: "1",
        requestId: "web-test-1",
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          retryable: true,
          details: {
            provider: "fixture",
          },
        },
      },
      {
        status: 503,
      },
    );

  await assert.rejects(
    planRoutes(REQUEST, undefined, fetcher),
    (error: unknown) => {
      assert.ok(error instanceof RouteApiError);
      assert.equal(error.code, "UPSTREAM_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert.deepEqual(error.details, {
        provider: "fixture",
      });
      return true;
    },
  );
});

test("planRoutes rejects a malformed successful response", async () => {
  const fetcher: RouteApiFetch = async () =>
    Response.json({
      schemaVersion: "1",
      routes: [],
    });

  await assert.rejects(
    planRoutes(REQUEST, undefined, fetcher),
    (error: unknown) => {
      assert.ok(error instanceof RouteApiError);
      assert.equal(error.code, "INVALID_API_RESPONSE");
      assert.equal(error.status, 200);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("shared search parameters are bounded and round-trip without geometry", () => {
  const defaults = routeFormFromSearch("");
  const form = routeFormFromSearch(
    "?start=%E8%A5%BF%E6%B9%96&stop=%E5%A4%AA%E5%AD%90%E6%B9%BE&stop=%E6%A4%8D%E7%89%A9%E5%9B%AD&mode=cycling&distance=999&greenery=-1&waterfront=0.4&lowTraffic=0.6",
  );
  const url = new URL(
    createRouteShareUrl(form, "https://example.com/routes?old=1#map"),
  );

  assert.equal(defaults.distanceKilometers, 5);
  assert.equal(defaults.greenery, 0.9);
  assert.equal(form.startQuery, "西湖");
  assert.equal(form.mode, "cycling");
  assert.equal(form.distanceKilometers, 50);
  assert.equal(form.greenery, 0);
  assert.deepEqual(form.requiredStops, ["太子湾", "植物园"]);
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("distance"), "50");
  assert.deepEqual(url.searchParams.getAll("stop"), ["太子湾", "植物园"]);
  assert.equal(url.searchParams.has("geometry"), false);
});

test("sharing a located start omits precise coordinates", () => {
  const url = new URL(
    createRouteShareUrl(
      {
        ...FORM,
        startQuery: "我的当前位置",
        startPoint: { longitude: 120.15, latitude: 30.25 },
      },
      "https://example.com/routes",
    ),
  );
  assert.equal(url.searchParams.get("location"), "required");
  assert.equal(url.searchParams.has("start"), false);
  assert.equal(url.search.includes("120.15"), false);
  assert.equal(routeFormFromSearch(url.search).startQuery, "");
});

test("routeExport enforces the delivery policy advertised by the API", () => {
  assert.equal(routeExport(DELIVERY_TEST_ROUTE, "gpx").extension, "gpx");
  assert.throws(
    () =>
      routeExport(
        {
          ...DELIVERY_TEST_ROUTE,
          delivery: {
            ...DELIVERY_TEST_ROUTE.delivery,
            exportFormats: [],
          },
        },
        "geojson",
      ),
    /ROUTE_EXPORT_NOT_ALLOWED/,
  );
});

test("routeExport resolves formats through an injected registry", () => {
  const registry = new RouteDeliveryRegistry({
    exporters: [
      {
        format: "kml",
        label: "下载 KML",
        exportRoute: (route) => ({
          contentType:
            "application/vnd.google-earth.kml+xml; charset=utf-8",
          extension: "kml",
          body: `<kml>${route.id}</kml>`,
        }),
      },
    ],
  });
  const route = {
    ...DELIVERY_TEST_ROUTE,
    delivery: {
      ...DELIVERY_TEST_ROUTE.delivery,
      exportFormats: ["kml"],
    },
  };

  assert.equal(
    routeExport(route, "kml", registry).body,
    "<kml>route-delivery-1</kml>",
  );
  assert.throws(
    () => routeExport(route, "gpx", registry),
    /ROUTE_EXPORT_NOT_ALLOWED/,
  );
});

test("basemap renderers can be registered and selected by id", () => {
  const renderer = defineBasemapRenderer({
    id: "example-map",
    displayName: "Example map",
    component: () => null,
  });
  const registry = new BasemapRendererRegistry([renderer]);

  assert.deepEqual(registry.require("example-map"), renderer);
  assert.deepEqual(registry.ids(), ["example-map"]);
  assert.throws(
    () => registry.require("missing"),
    /BASEMAP_RENDERER_NOT_REGISTERED/,
  );
  assert.throws(
    () => new BasemapRendererRegistry([renderer, renderer]),
    /BASEMAP_RENDERER_DUPLICATE/,
  );
});

test("base and reference map layer providers share one extension registry", () => {
  const base = defineMapLayerProvider<{}, string>({
    id: "example-satellite",
    displayName: "Example satellite",
    kind: "base",
    attribution: "Example imagery",
    coordinateSystem: "WGS84",
    createLayers: () => ["satellite"],
  });
  const reference = defineMapLayerProvider<{}, string>({
    id: "example-terrain",
    displayName: "Example terrain",
    kind: "reference",
    attribution: "Example terrain data",
    coordinateSystem: "WGS84",
    defaultEnabled: true,
    createLayers: () => ["terrain"],
  });
  const registry = new MapLayerProviderRegistry([base, reference]);

  assert.deepEqual(registry.ids("base"), ["example-satellite"]);
  assert.deepEqual(registry.ids("reference"), ["example-terrain"]);
  assert.equal(registry.require("example-terrain").defaultEnabled, true);
  assert.throws(
    () => new MapLayerProviderRegistry([base, base]),
    /MAP_LAYER_PROVIDER_DUPLICATE/,
  );
});

test("the default AMap profile starts with satellite plus road net", () => {
  class StandardLayer {
    readonly kind = "standard";
    static readonly Satellite = class SatelliteLayer {
      readonly kind = "satellite";
    };
    static readonly RoadNet = class RoadNetLayer {
      readonly kind = "road-net";
    };
  }
  const AMap = {
    TileLayer: StandardLayer,
  } as unknown as AmapNamespace;

  assert.deepEqual(defaultAmapMapLayerRegistry.ids("base"), [
    "amap-satellite",
    "amap-standard",
  ]);
  assert.deepEqual(
    amapSatelliteLayerProvider
      .createLayers({ AMap })
      .map((layer) => layer.kind),
    ["satellite", "road-net"],
  );
  assert.deepEqual(
    amapStandardLayerProvider
      .createLayers({ AMap })
      .map((layer) => layer.kind),
    ["standard"],
  );
});

test("web map config exposes only the public key and fails closed", async () => {
  const enabled = await loadWebMapConfig(async () =>
    Response.json({
      schemaVersion: "1",
      enabled: true,
      providerId: "amap-jsapi",
      key: "public-web-key",
      serviceHost: "/_AMapService",
      securityCode: "must-not-be-retained",
    }),
  );
  const malformed = await loadWebMapConfig(async () =>
    Response.json({
      schemaVersion: "1",
      enabled: true,
      providerId: "amap-jsapi",
      key: "",
      serviceHost: "https://attacker.example",
    }),
  );

  assert.deepEqual(enabled, {
    enabled: true,
    providerId: "amap-jsapi",
    key: "public-web-key",
    serviceHost: "/_AMapService",
  });
  assert.deepEqual(malformed, { enabled: false });
});

test("anonymous session and save clients send bearer-scoped contracts", async () => {
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];
  const fetcher: RouteApiFetch = async (input, init) => {
    calls.push({ input, init });
    if (input === "/api/v1/session") {
      return Response.json(
        {
          schemaVersion: "1",
          requestId: "session-test",
          session: {
            token: "zhaolu.v1.payload.signature",
            expiresAt: 1_900_000_000_000,
          },
        },
        { status: 201 },
      );
    }
    return Response.json(
      {
        schemaVersion: "1",
        requestId: "save-test",
        route: {
          id: "saved-1",
          name: "西湖晨跑",
          mode: "cycling",
          providerId: "fake-route",
          distanceMeters: 5_120,
          durationSeconds: 1_800,
          score: 82.5,
          hasGeometry: true,
          createdAt: 1,
          expiresAt: 2,
        },
      },
      { status: 201 },
    );
  };

  const session = await createAnonymousSession(fetcher);
  const saved = await saveRoute(
    session.token,
    {
      name: "西湖晨跑",
      request: REQUEST,
      route: DELIVERY_TEST_ROUTE,
    },
    "save-test-1",
    fetcher,
  );

  assert.equal(saved.id, "saved-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.input, "/api/v1/session");
  assert.equal(calls[1]?.input, "/api/v1/saved-routes");
  assert.equal(
    (calls[1]?.init?.headers as Record<string, string>)
      .authorization,
    `Bearer ${session.token}`,
  );
  assert.equal(
    (calls[1]?.init?.headers as Record<string, string>)[
      "idempotency-key"
    ],
    "save-test-1",
  );
});

test("loads public legal config and deletes all anonymous device data", async () => {
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];
  const fetcher: RouteApiFetch = async (input, init) => {
    calls.push({ input, init });
    if (input === "/api/v1/legal-config") {
      return Response.json({
        schemaVersion: "1",
        documentVersion: "2026-08-01",
        configured: true,
        operatorName: "找路测试运营者",
        privacyContact: "privacy@example.test",
        logRetentionDays: 30,
      });
    }
    return Response.json({
      schemaVersion: "1",
      requestId: "delete-all-test",
      deleted: true,
    });
  };

  const legal = await loadLegalConfig(fetcher);
  await deleteAllUserData("session-token", fetcher);

  assert.equal(legal.operatorName, "找路测试运营者");
  assert.equal(calls[0]?.input, "/api/v1/legal-config");
  assert.equal(calls[1]?.input, "/api/v1/session");
  assert.equal(calls[1]?.init?.method, "DELETE");
  assert.equal(
    (calls[1]?.init?.headers as Record<string, string>)
      .authorization,
    "Bearer session-token",
  );
});

test("session coordinator shares creation and recovers once from 401", async () => {
  let stored: { token: string; expiresAt: number } | null = null;
  let createCount = 0;
  let clearCount = 0;
  let releaseFirstCreation:
    | ((session: { token: string; expiresAt: number }) => void)
    | undefined;
  const firstCreation = new Promise<{
    token: string;
    expiresAt: number;
  }>((resolve) => {
    releaseFirstCreation = resolve;
  });
  const coordinator = createAnonymousSessionCoordinator({
    read: () => stored,
    write: (session) => {
      stored = session;
    },
    clear: () => {
      clearCount += 1;
      stored = null;
    },
    create: async () => {
      createCount += 1;
      if (createCount === 1) return firstCreation;
      return {
        token: `session-${createCount}`,
        expiresAt: 1_900_000_000_000,
      };
    },
  });

  const firstToken = coordinator.token();
  const secondToken = coordinator.token();
  assert.equal(createCount, 1);
  releaseFirstCreation?.({
    token: "session-1",
    expiresAt: 1_900_000_000_000,
  });
  assert.deepEqual(
    await Promise.all([firstToken, secondToken]),
    ["session-1", "session-1"],
  );

  const attemptedTokens: string[] = [];
  const result = await coordinator.run(async (token) => {
    attemptedTokens.push(token);
    if (token === "session-1") {
      throw new RouteApiError("UNAUTHORIZED", 401, false);
    }
    return "recovered";
  });
  assert.equal(result, "recovered");
  assert.deepEqual(attemptedTokens, ["session-1", "session-2"]);
  assert.equal(createCount, 2);
  assert.equal(clearCount, 1);
});
