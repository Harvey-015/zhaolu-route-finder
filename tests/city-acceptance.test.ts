import assert from "node:assert/strict";
import test from "node:test";
import { runCityAcceptance } from "../scripts/acceptance-cities.ts";

function routeResponse(requestId: string, targetDistanceMeters: number) {
  return {
    schemaVersion: "1",
    requestId,
    status: "complete",
    start: {},
    requiredStops: [],
    warnings: [],
    diagnostics: {},
    routes: [
      {
        id: `route-${requestId}`,
        candidateId: "candidate-1",
        geometry: {
          type: "LineString",
          coordinates: [
            [120.1, 30.2],
            [120.2, 30.3],
          ],
        },
        distanceMeters: targetDistanceMeters,
        durationSeconds: 1_800,
        directionDegrees: 90,
        source: { providerId: "amap-route" },
        scenicFeatures: {},
        score: { total: 0.8 },
        delivery: {},
      },
    ],
  };
}

test("checks three real-city cases with exactly three sequential requests", async () => {
  let active = 0;
  let maximumActive = 0;
  const queries: string[] = [];
  const result = await runCityAcceptance({
    environment: {
      CITY_ACCEPTANCE_BASE_URL: "https://staging.example.test",
      CITY_ACCEPTANCE_CONFIRMATION:
        "staging-only-three-live-requests-approved",
    },
    now: () => 1_000,
    fetcher: async (_input, init) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const request = JSON.parse(String(init?.body)) as {
        requestId: string;
        start: { query: string };
        targetDistanceMeters: number;
      };
      queries.push(request.start.query);
      active -= 1;
      return new Response(
        JSON.stringify(
          routeResponse(request.requestId, request.targetDistanceMeters),
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.requestCount, 3);
  assert.equal(result.cases.length, 3);
  assert.equal(maximumActive, 1);
  assert.deepEqual(queries, [
    "杭州西湖断桥",
    "上海世纪公园",
    "成都青龙湖湿地公园",
  ]);
});

test("fails closed for non-HTTPS targets and invalid route geometry", async () => {
  const invalidOrigin = await runCityAcceptance({
    environment: {
      CITY_ACCEPTANCE_BASE_URL: "http://staging.example.test",
      CITY_ACCEPTANCE_CONFIRMATION:
        "staging-only-three-live-requests-approved",
    },
  });
  assert.equal(
    invalidOrigin.code,
    "CITY_ACCEPTANCE_CONFIGURATION_INVALID",
  );

  const invalidRoute = await runCityAcceptance({
    environment: {
      CITY_ACCEPTANCE_BASE_URL: "https://staging.example.test",
      CITY_ACCEPTANCE_CONFIRMATION:
        "staging-only-three-live-requests-approved",
      CITY_ACCEPTANCE_CASES_JSON: JSON.stringify([
        {
          name: "测试城市",
          startQuery: "测试公园",
          mode: "running",
          targetDistanceMeters: 5_000,
        },
      ]),
    },
    now: () => 1_000,
    fetcher: async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {
        requestId: string;
      };
      const body = routeResponse(request.requestId, 5_000);
      body.routes[0].geometry.coordinates[0] = [200, 95];
      return new Response(JSON.stringify(body));
    },
  });
  assert.equal(invalidRoute.status, "failed");
  assert.equal(invalidRoute.code, "CITY_ACCEPTANCE_REQUEST_FAILED");
});
