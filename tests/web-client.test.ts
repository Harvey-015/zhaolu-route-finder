import assert from "node:assert/strict";
import test from "node:test";

import {
  planRoutes,
  RouteApiError,
  type RouteApiFetch,
} from "../web/src/api.ts";
import {
  buildPlanRequest,
  type RouteFormState,
} from "../web/src/model.ts";
import {
  createRouteShareUrl,
  routeExport,
  routeFormFromSearch,
} from "../web/src/delivery.ts";
import {
  createAnonymousSession,
  saveRoute,
} from "../web/src/userDataApi.ts";
import type {
  PlanRoutesApiRequest,
  PlanRoutesApiResponse,
} from "../src/server-api/contracts.ts";
import { DELIVERY_TEST_ROUTE } from "./fixtures/delivery.ts";

const FORM: RouteFormState = {
  startQuery: "  杭州西湖  ",
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
    "?start=%E8%A5%BF%E6%B9%96&mode=cycling&distance=999&greenery=-1&waterfront=0.4&lowTraffic=0.6",
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
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("distance"), "50");
  assert.equal(url.searchParams.has("geometry"), false);
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
});
