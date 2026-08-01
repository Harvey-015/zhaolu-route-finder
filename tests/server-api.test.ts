import assert from "node:assert/strict";
import test from "node:test";
import {
  wgs84Point,
} from "../src/route-recommendation/coordinates.ts";
import { RouteRecommendationError } from "../src/route-recommendation/errors.ts";
import type {
  FindScenicRoutesRequest,
  FindScenicRoutesResult,
} from "../src/route-recommendation/models.ts";
import {
  createServerApi,
  MAX_SERVER_API_BODY_BYTES,
  type PlanScenicRoutes,
} from "../src/server-api/handler.ts";

function apiBody(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    schemaVersion: "1",
    requestId: "api-contract",
    start: {
      kind: "point",
      longitude: 120.145,
      latitude: 30.26,
      crs: "WGS84",
      label: "Start",
    },
    mode: "running",
    targetDistanceMeters: 5_000,
    preferences: {
      greenery: 1,
      waterfront: 0.8,
      lowTraffic: 0.7,
      comfort: 0.5,
    },
    maxResults: 1,
    ...overrides,
  };
}

function coreResult(
  request: FindScenicRoutesRequest,
): FindScenicRoutesResult {
  const origin =
    request.start.kind === "point"
      ? request.start.point
      : wgs84Point(120.145, 30.26);
  const destination = wgs84Point(
    origin.longitude + 0.002,
    origin.latitude + 0.002,
  );
  return {
    requestId: request.requestId,
    status: "complete",
    start: {
      id: "place-start",
      name: "Start",
      point: origin,
      source: { providerId: "fixture-place" },
    },
    requiredStops: [],
    routes: [
      {
        route: {
          id: "route-1",
          candidateId: "candidate-1",
          geometry: [origin, destination],
          segments: [
            {
              index: 0,
              geometry: [origin, destination],
              distanceMeters: 300,
              durationSeconds: 120,
            },
          ],
          distanceMeters: 300,
          durationSeconds: 120,
          directionDegrees: 45,
          source: {
            providerId: "fixture-route",
            externalId: "external-route-1",
          },
        },
        scenicFeatures: {
          availability: "partial",
          greenCoverage: {
            value: 0.8,
            confidence: 1,
            source: { providerId: "fixture-scenery" },
            sourceVersion: "fixture-v1",
          },
          waterfrontProximity: null,
          builtUpExposure: null,
          roadComfort: null,
        },
        score: {
          total: 82,
          dimensions: {
            distanceFit: 95,
            greenery: 80,
            waterfront: 0,
            lowTraffic: 0,
            comfort: 0,
          },
          penalties: {
            excessiveDetour: 5,
            builtUpExposure: 0,
          },
          policyId: "fixture-score",
          policyVersion: "1",
          reasons: [
            { code: "DISTANCE_FIT", contribution: 95 },
            { code: "GREENERY", contribution: 80 },
          ],
        },
        reasons: [
          { code: "DISTANCE_FIT", contribution: 95 },
          { code: "GREENERY", contribution: 80 },
        ],
      },
    ],
    warnings: [],
    diagnostics: {
      generatedCandidateCount: 1,
      routedCandidateCount: 1,
      selectedRouteCount: 1,
      sceneryDegraded: false,
      degradedSceneryRouteIds: [],
    },
  };
}

function jsonRequest(
  body: unknown,
  options: Readonly<{
    method?: string;
    path?: string;
    signal?: AbortSignal;
    headers?: HeadersInit;
  }> = {},
) {
  return new Request(
    `http://localhost${options.path ?? "/api/v1/routes/plan"}`,
    {
      method: options.method ?? "POST",
      headers: {
        "content-type": "application/json",
        ...options.headers,
      },
      body:
        options.method === "GET" ? undefined : JSON.stringify(body),
      signal: options.signal,
    },
  );
}

test("exposes stable health and capability discovery endpoints", async () => {
  let planCallCount = 0;
  const handler = createServerApi({
    planRoutes: async (request) => {
      planCallCount += 1;
      return coreResult(request);
    },
    requestIdFactory: () => "generated-health",
    webMapConfig: {
      providerId: "amap-jsapi",
      key: "public-web-key",
      serviceHost: "/_AMapService",
    },
    legalConfig: {
      operatorName: "找路测试运营者",
      privacyContact: "privacy@example.test",
      logRetentionDays: 30,
    },
  });

  const health = await handler(
    new Request("http://localhost/api/v1/health"),
  );
  const readiness = await handler(
    new Request("http://localhost/api/v1/ready"),
  );
  const capabilities = await handler(
    new Request("http://localhost/api/v1/capabilities"),
  );
  const openApi = await handler(
    new Request("http://localhost/api/v1/openapi.json"),
  );
  const mapConfig = await handler(
    new Request("http://localhost/api/v1/map-config"),
  );
  const legalConfig = await handler(
    new Request("http://localhost/api/v1/legal-config"),
  );
  const healthBody = (await health.json()) as Record<string, unknown>;
  const readinessBody =
    (await readiness.json()) as Record<string, unknown>;
  const capabilitiesBody =
    (await capabilities.json()) as Record<string, unknown>;
  const mapConfigBody =
    (await mapConfig.json()) as Record<string, unknown>;
  const legalConfigBody =
    (await legalConfig.json()) as Record<string, unknown>;
  const openApiBody = (await openApi.json()) as {
    openapi: string;
    paths: Record<
      string,
      Record<string, { parameters?: unknown[]; responses: Record<string, unknown> }>
    >;
  };

  assert.equal(health.status, 200);
  assert.equal(healthBody.status, "ok");
  assert.equal(readiness.status, 200);
  assert.equal(readinessBody.status, "ready");
  assert.equal(capabilities.status, 200);
  assert.equal(
    capabilitiesBody.coordinateReferenceSystem,
    "WGS84",
  );
  assert.equal(capabilitiesBody.geometryFormat, "GeoJSON");
  assert.deepEqual(capabilitiesBody.webMap, {
    available: true,
    providerId: "amap-jsapi",
    configDocument: "/api/v1/map-config",
  });
  assert.equal(
    capabilitiesBody.openApiDocument,
    "/api/v1/openapi.json",
  );
  assert.equal(openApi.status, 200);
  assert.equal(openApiBody.openapi, "3.1.0");
  assert.ok("/api/v1/ready" in openApiBody.paths);
  assert.ok("/api/v1/map-config" in openApiBody.paths);
  assert.ok("/api/v1/legal-config" in openApiBody.paths);
  assert.ok("/api/v1/routes/plan" in openApiBody.paths);
  assert.ok("/api/v1/session" in openApiBody.paths);
  assert.ok("delete" in openApiBody.paths["/api/v1/session"]);
  assert.ok("/api/v1/saved-routes" in openApiBody.paths);
  assert.ok(
    "429" in
      openApiBody.paths["/api/v1/session"].post.responses,
  );
  assert.ok(
    "503" in
      openApiBody.paths["/api/v1/saved-routes"].get.responses,
  );
  assert.ok(
    "415" in
      openApiBody.paths["/api/v1/saved-routes"].post.responses,
  );
  assert.ok(
    openApiBody.paths["/api/v1/saved-routes"].post.parameters?.some(
      (parameter) =>
        typeof parameter === "object" &&
        parameter !== null &&
        "name" in parameter &&
        parameter.name === "Idempotency-Key",
    ),
  );
  assert.equal(planCallCount, 0);
  assert.equal(mapConfig.status, 200);
  assert.deepEqual(mapConfigBody, {
    schemaVersion: "1",
    enabled: true,
    providerId: "amap-jsapi",
    key: "public-web-key",
    serviceHost: "/_AMapService",
  });
  assert.equal(legalConfig.status, 200);
  assert.deepEqual(legalConfigBody, {
    schemaVersion: "1",
    documentVersion: "2026-08-01",
    configured: true,
    operatorName: "找路测试运营者",
    privacyContact: "privacy@example.test",
    logRetentionDays: 30,
  });
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.equal(
    health.headers.get("x-content-type-options"),
    "nosniff",
  );
});

test("advertises the delivery extensions installed by the composition root", async () => {
  const handler = createServerApi({
    planRoutes: async (request) => coreResult(request),
    deliveryCapabilities: {
      exportFormats: ["geojson", "kml"],
      navigationTargets: ["example-maps"],
    },
  });

  const response = await handler(
    new Request("http://localhost/api/v1/capabilities"),
  );
  const body = (await response.json()) as {
    routeDelivery: {
      exportFormats: string[];
      navigationTargets: string[];
    };
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body.routeDelivery.exportFormats, [
    "geojson",
    "kml",
  ]);
  assert.deepEqual(body.routeDelivery.navigationTargets, [
    "example-maps",
  ]);
});

test("maps a valid API request to core and returns GeoJSON", async () => {
  let received: FindScenicRoutesRequest | undefined;
  let receivedSignal: AbortSignal | undefined;
  const handler = createServerApi({
    planRoutes: async (request, signal) => {
      received = request;
      receivedSignal = signal;
      return coreResult(request);
    },
  });

  const response = await handler(jsonRequest(apiBody()));
  const body = (await response.json()) as {
    schemaVersion: string;
    requestId: string;
    start: {
      point: { type: string; coordinates: [number, number] };
    };
    routes: Array<{
      geometry: {
        type: string;
        coordinates: Array<[number, number]>;
      };
      delivery: {
        exportFormats: string[];
        persistence: string;
      };
    }>;
  };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-request-id"), "api-contract");
  assert.equal(body.schemaVersion, "1");
  assert.equal(body.requestId, "api-contract");
  assert.equal(received?.start.kind, "point");
  if (received?.start.kind === "point") {
    assert.equal(received.start.point.crs, "WGS84");
    assert.equal(received.start.point.longitude, 120.145);
  }
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(body.start.point.type, "Point");
  assert.deepEqual(body.start.point.coordinates, [120.145, 30.26]);
  assert.equal(body.routes[0].geometry.type, "LineString");
  assert.deepEqual(body.routes[0].geometry.coordinates[0], [
    120.145,
    30.26,
  ]);
  assert.deepEqual(body.routes[0].delivery.exportFormats, []);
  assert.equal(body.routes[0].delivery.persistence, "denied");
});

test("supports query places and generates a request id when absent", async () => {
  let received: FindScenicRoutesRequest | undefined;
  const handler = createServerApi({
    planRoutes: async (request) => {
      received = request;
      return coreResult(request);
    },
    requestIdFactory: () => "generated-query-id",
  });
  const value = apiBody({
    requestId: undefined,
    start: { kind: "query", query: "  Hangzhou West Lake  " },
  });

  const response = await handler(jsonRequest(value));
  const body = (await response.json()) as { requestId: string };

  assert.equal(response.status, 200);
  assert.deepEqual(received?.start, {
    kind: "query",
    query: "Hangzhou West Lake",
  });
  assert.equal(body.requestId, "generated-query-id");
  assert.equal(
    response.headers.get("x-request-id"),
    "generated-query-id",
  );
});

test("rejects ambiguous coordinates before calling the core", async () => {
  let planCallCount = 0;
  const handler = createServerApi({
    planRoutes: async (request) => {
      planCallCount += 1;
      return coreResult(request);
    },
  });
  const value = apiBody({
    start: {
      kind: "point",
      longitude: 120.145,
      latitude: 30.26,
      crs: "GCJ02",
    },
  });

  const response = await handler(jsonRequest(value));
  const body = (await response.json()) as {
    error: { code: string; details: { field: string } };
  };

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "INVALID_REQUEST");
  assert.equal(body.error.details.field, "start.crs");

  const unexpected = await handler(
    jsonRequest(apiBody({ targetDistanceMeter: 5_000 })),
  );
  const unexpectedBody = (await unexpected.json()) as {
    error: { details: { field: string } };
  };
  assert.equal(unexpected.status, 400);
  assert.equal(
    unexpectedBody.error.details.field,
    "targetDistanceMeter",
  );
  assert.equal(planCallCount, 0);
});

test("enforces JSON content type, syntax and body-size limits", async () => {
  const handler = createServerApi({
    planRoutes: async (request) => coreResult(request),
  });
  const unsupported = await handler(
    new Request("http://localhost/api/v1/routes/plan", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
  );
  const malformed = await handler(
    new Request("http://localhost/api/v1/routes/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
  );
  const oversized = await handler(
    new Request("http://localhost/api/v1/routes/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(MAX_SERVER_API_BODY_BYTES + 1),
    }),
  );

  assert.equal(unsupported.status, 415);
  assert.equal(
    ((await unsupported.json()) as { error: { code: string } }).error
      .code,
    "UNSUPPORTED_MEDIA_TYPE",
  );
  assert.equal(malformed.status, 400);
  assert.equal(
    ((await malformed.json()) as { error: { code: string } }).error
      .code,
    "INVALID_JSON",
  );
  assert.equal(oversized.status, 413);
  assert.equal(
    ((await oversized.json()) as { error: { code: string } }).error
      .code,
    "PAYLOAD_TOO_LARGE",
  );
});

test("maps core errors to stable HTTP statuses without leaking causes", async () => {
  const events: Array<{
    event: string;
    fields?: Readonly<Record<string, unknown>>;
  }> = [];
  const eventLogger = {
    info: (event: string, fields?: Readonly<Record<string, unknown>>) =>
      events.push({ event, fields }),
    error: (event: string, fields?: Readonly<Record<string, unknown>>) =>
      events.push({ event, fields }),
  };
  const quotaHandler = createServerApi({
    planRoutes: async () => {
      throw new RouteRecommendationError({
        code: "ROUTE_PROVIDER_QUOTA_EXCEEDED",
        retryable: false,
      });
    },
  });
  const internalHandler = createServerApi({
    planRoutes: async () => {
      throw new Error("secret upstream response");
    },
    eventLogger,
  });

  const quota = await quotaHandler(jsonRequest(apiBody()));
  const internal = await internalHandler(jsonRequest(apiBody()));
  const quotaText = await quota.text();
  const internalText = await internal.text();

  assert.equal(quota.status, 429);
  assert.equal(JSON.parse(quotaText).error.code, "ROUTE_PROVIDER_QUOTA_EXCEEDED");
  assert.equal(internal.status, 500);
  assert.equal(JSON.parse(internalText).error.code, "INTERNAL_ERROR");
  assert.ok(!internalText.includes("secret upstream response"));
  assert.equal(events[0]?.event, "route_plan_failed");
  assert.equal(events[0]?.fields?.code, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(events), /secret upstream response/);
});

test("emits safe route diagnostics without logging user locations", async () => {
  const events: Array<{
    event: string;
    fields?: Readonly<Record<string, unknown>>;
  }> = [];
  const handler = createServerApi({
    planRoutes: async (request) => coreResult(request),
    eventLogger: {
      info: (event, fields) => events.push({ event, fields }),
      error: (event, fields) => events.push({ event, fields }),
    },
  });

  const response = await handler(
    jsonRequest(
      apiBody({
        start: { kind: "query", query: "不应进入日志的地点" },
      }),
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(events[0]?.event, "route_plan_completed");
  assert.equal(events[0]?.fields?.generatedCandidateCount, 1);
  assert.equal(events[0]?.fields?.selectedRouteCount, 1);
  assert.doesNotMatch(JSON.stringify(events), /不应进入日志的地点/);
});

test("enforces API timeout and propagates cancellation", async () => {
  let timeoutSignal: AbortSignal | undefined;
  const hangingPlanner: PlanScenicRoutes = async (
    _request,
    signal,
  ) => {
    timeoutSignal = signal;
    return new Promise<FindScenicRoutesResult>(() => {});
  };
  const timeoutHandler = createServerApi({
    planRoutes: hangingPlanner,
    timeoutMs: 10,
  });

  const timeoutResponse = await timeoutHandler(
    jsonRequest(apiBody()),
  );
  const timeoutBody = (await timeoutResponse.json()) as {
    error: { code: string; retryable: boolean };
  };
  assert.equal(timeoutResponse.status, 504);
  assert.equal(timeoutBody.error.code, "REQUEST_TIMEOUT");
  assert.equal(timeoutBody.error.retryable, true);
  assert.equal(timeoutSignal?.aborted, true);

  const controller = new AbortController();
  const cancellationHandler = createServerApi({
    planRoutes: hangingPlanner,
    timeoutMs: 1_000,
  });
  const pending = cancellationHandler(
    jsonRequest(apiBody(), { signal: controller.signal }),
  );
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.status, 408);
  assert.equal(
    ((await cancelled.json()) as { error: { code: string } }).error
      .code,
    "REQUEST_ABORTED",
  );
});

test("returns stable 404 and 405 envelopes", async () => {
  const handler = createServerApi({
    planRoutes: async (request) => coreResult(request),
    requestIdFactory: () => "routing-error",
  });

  const missing = await handler(
    new Request("http://localhost/api/v1/missing"),
  );
  const wrongMethod = await handler(
    new Request("http://localhost/api/v1/routes/plan"),
  );

  assert.equal(missing.status, 404);
  assert.equal(
    ((await missing.json()) as { error: { code: string } }).error.code,
    "ENDPOINT_NOT_FOUND",
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
});
