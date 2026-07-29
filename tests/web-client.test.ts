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
import type {
  PlanRoutesApiRequest,
  PlanRoutesApiResponse,
} from "../src/server-api/contracts.ts";

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
