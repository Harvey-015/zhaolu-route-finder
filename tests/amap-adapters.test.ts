import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  gcj02ToWgs84,
  wgs84ToGcj02,
} from "../src/adapters/amap/coordinates.ts";
import {
  AmapWebServiceClient,
  type AmapFetch,
} from "../src/adapters/amap/httpClient.ts";
import { mapAmapRouteLegResponse } from "../src/adapters/amap/mappers.ts";
import { AmapPlaceProvider } from "../src/adapters/amap/placeProvider.ts";
import { AmapRouteProvider } from "../src/adapters/amap/routeProvider.ts";
import {
  distanceMeters,
  gcj02Point,
  wgs84Point,
} from "../src/route-recommendation/coordinates.ts";
import { ProviderError } from "../src/route-recommendation/errors.ts";
import type { RouteCandidate } from "../src/route-recommendation/models.ts";

const context = { requestId: "amap-fixture-request" } as const;

async function fixture(name: string): Promise<unknown> {
  const contents = await readFile(
    new URL(`./fixtures/amap/${name}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(contents) as unknown;
}

function queuedFetcher(payloads: readonly unknown[]) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  let index = 0;
  const fetcher: AmapFetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const payload = payloads[index];
    index += 1;
    if (payload === undefined) {
      throw new Error("Unexpected fixture request");
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetcher };
}

function loopCandidate(): RouteCandidate {
  const origin = gcj02ToWgs84(gcj02Point(120.153576, 30.24445));
  const waypoint = gcj02ToWgs84(gcj02Point(120.1543, 30.2451));
  return {
    id: "candidate-amap-loop",
    origin,
    destination: origin,
    waypoints: [waypoint],
    requiredStops: [],
    scenicAnchorIds: [],
    directionDegrees: 45,
    targetDistanceMeters: 250,
  };
}

test("converts WGS-84 and GCJ-02 only at the adapter boundary", () => {
  const tiananmenWgs84 = wgs84Point(116.397128, 39.916527);
  const converted = wgs84ToGcj02(tiananmenWgs84);
  const roundTrip = gcj02ToWgs84(converted);

  assert.equal(converted.crs, "GCJ02");
  assert.ok(Math.abs(converted.longitude - 116.403372) < 0.0001);
  assert.ok(Math.abs(converted.latitude - 39.91793) < 0.0001);
  assert.ok(distanceMeters(tiananmenWgs84, roundTrip) < 1);

  const outsideChina = wgs84Point(-0.1276, 51.5072);
  const unchanged = wgs84ToGcj02(outsideChina);
  assert.equal(unchanged.longitude, outsideChina.longitude);
  assert.equal(unchanged.latitude, outsideChina.latitude);
});

test("maps an AMap geocode fixture to a provider-neutral place", async () => {
  const queue = queuedFetcher([await fixture("geocode-success.json")]);
  const client = new AmapWebServiceClient({
    apiKey: "fixture-key",
    fetcher: queue.fetcher,
  });
  const provider = new AmapPlaceProvider(client, { city: "杭州" });

  const place = await provider.resolve(
    { input: { kind: "query", query: "杭州西湖" } },
    context,
  );

  assert.equal(place.name, "浙江省杭州市西湖区西湖风景名胜区");
  assert.equal(place.point.crs, "WGS84");
  assert.equal(place.source.providerId, "amap-place");
  assert.equal(queue.calls.length, 1);
  assert.equal(queue.calls[0].url.pathname, "/v3/geocode/geo");
  assert.equal(queue.calls[0].url.searchParams.get("address"), "杭州西湖");
  assert.equal(queue.calls[0].url.searchParams.get("city"), "杭州");
  assert.equal(queue.calls[0].url.searchParams.get("key"), "fixture-key");
});

test("resolves an already normalized point without calling AMap", async () => {
  const queue = queuedFetcher([]);
  const provider = new AmapPlaceProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      fetcher: queue.fetcher,
    }),
  );
  const point = wgs84Point(120.149, 30.259);

  const place = await provider.resolve(
    { input: { kind: "point", point, label: "已选起点" } },
    context,
  );

  assert.equal(place.point, point);
  assert.equal(place.name, "已选起点");
  assert.equal(queue.calls.length, 0);
});

test("maps an empty geocode result to NOT_FOUND", async () => {
  const queue = queuedFetcher([await fixture("geocode-empty.json")]);
  const provider = new AmapPlaceProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      fetcher: queue.fetcher,
    }),
  );

  await assert.rejects(
    () =>
      provider.resolve(
        { input: { kind: "query", query: "不存在的地点" } },
        context,
      ),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "NOT_FOUND",
  );
});

test("maps AMap quota responses to a stable provider error", async () => {
  const queue = queuedFetcher([await fixture("quota-error.json")]);
  const provider = new AmapPlaceProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      fetcher: queue.fetcher,
    }),
  );

  await assert.rejects(
    () =>
      provider.resolve(
        { input: { kind: "query", query: "杭州西湖" } },
        context,
      ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "QUOTA_EXCEEDED" &&
      error.message === "AMAP_QUOTA_EXCEEDED",
  );
  assert.equal(queue.calls.length, 1);
});

test("retries one transient HTTP failure in the shared AMap client", async () => {
  const success = await fixture("geocode-success.json");
  let attempts = 0;
  const fetcher: AmapFetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("temporary unavailable", { status: 503 });
    }
    return new Response(JSON.stringify(success), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const provider = new AmapPlaceProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      maxAttempts: 2,
      retryDelayMs: 0,
      fetcher,
    }),
  );

  const place = await provider.resolve(
    { input: { kind: "query", query: "杭州西湖" } },
    context,
  );

  assert.equal(place.point.crs, "WGS84");
  assert.equal(attempts, 2);
});

test("splits a running loop into ordered AMap legs and merges WGS-84 output", async () => {
  const queue = queuedFetcher([
    await fixture("walking-leg-1.json"),
    await fixture("walking-leg-2.json"),
  ]);
  const provider = new AmapRouteProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      fetcher: queue.fetcher,
    }),
  );
  const candidate = loopCandidate();

  const route = await provider.getRoute(
    { candidate, mode: "running" },
    context,
  );

  assert.equal(queue.calls.length, 2);
  assert.ok(
    queue.calls.every(
      ({ url }) => url.pathname === "/v5/direction/walking",
    ),
  );
  assert.ok(
    queue.calls.every(
      ({ url }) =>
        url.searchParams.get("show_fields") === "cost,navi" &&
        url.searchParams.get("alternative_route") === "1",
    ),
  );
  assert.equal(route.candidateId, candidate.id);
  assert.equal(route.source.providerId, "amap-route");
  assert.equal(route.distanceMeters, 250);
  assert.equal(route.durationSeconds, 185);
  assert.equal(route.segments.length, 2);
  assert.ok(route.geometry.every(({ crs }) => crs === "WGS84"));
  assert.ok(distanceMeters(route.geometry[0], candidate.origin) < 1);
  assert.ok(distanceMeters(route.geometry.at(-1)!, candidate.origin) < 1);
});

test("uses the bicycling endpoint for cycling candidates", async () => {
  const queue = queuedFetcher([await fixture("walking-leg-1.json")]);
  const provider = new AmapRouteProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      fetcher: queue.fetcher,
    }),
  );
  const loop = loopCandidate();
  const candidate: RouteCandidate = {
    ...loop,
    destination: loop.waypoints[0],
    waypoints: [],
  };

  await provider.getRoute({ candidate, mode: "cycling" }, context);

  assert.equal(
    queue.calls[0].url.pathname,
    "/v5/direction/bicycling",
  );
  assert.equal(queue.calls[0].url.searchParams.has("isindoor"), false);
});

test("enforces the per-candidate HTTP leg budget before calling AMap", async () => {
  const queue = queuedFetcher([]);
  const provider = new AmapRouteProvider(
    new AmapWebServiceClient({
      apiKey: "fixture-key",
      fetcher: queue.fetcher,
    }),
    { maxLegsPerRoute: 1 },
  );

  await assert.rejects(
    () =>
      provider.getRoute(
        { candidate: loopCandidate(), mode: "running" },
        context,
      ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "INVALID_RESPONSE" &&
      error.message === "AMAP_ROUTE_LEG_LIMIT_EXCEEDED",
  );
  assert.equal(queue.calls.length, 0);
});

test("maps an empty AMap route result to NOT_FOUND", () => {
  assert.throws(
    () =>
      mapAmapRouteLegResponse(
        {
          status: "1",
          info: "OK",
          infocode: "10000",
          count: "1",
          route: { origin: "0,0", destination: "1,1", paths: [] },
        },
        "amap-route",
      ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "NOT_FOUND",
  );
});

test("maps malformed AMap route geometry to INVALID_RESPONSE", () => {
  assert.throws(
    () =>
      mapAmapRouteLegResponse(
        {
          status: "1",
          info: "OK",
          infocode: "10000",
          count: "1",
          route: {
            origin: "0,0",
            destination: "1,1",
            paths: [
              {
                distance: "10",
                steps: [{ step_distance: "10", polyline: "not-a-point" }],
              },
            ],
          },
        },
        "amap-route",
      ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "INVALID_RESPONSE",
  );
});

test("maps client timeout and caller cancellation without leaking causes", async () => {
  const waitingFetcher: AmapFetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("private upstream detail", "AbortError")),
        { once: true },
      );
    });
  const timeoutProvider = new AmapPlaceProvider(
    new AmapWebServiceClient({
      apiKey: "secret-fixture-key",
      timeoutMs: 5,
      fetcher: waitingFetcher,
    }),
  );

  await assert.rejects(
    () =>
      timeoutProvider.resolve(
        { input: { kind: "query", query: "杭州西湖" } },
        context,
      ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "TIMEOUT" &&
      error.message === "AMAP_REQUEST_TIMEOUT" &&
      error.cause === undefined &&
      !error.message.includes("secret-fixture-key"),
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      timeoutProvider.resolve(
        { input: { kind: "query", query: "杭州西湖" } },
        { requestId: "cancelled-request", signal: controller.signal },
      ),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "ABORTED",
  );
});

test("does not preserve network error messages or API keys in provider errors", async () => {
  const fetcher: AmapFetch = async () => {
    throw new Error("private network error containing secret-fixture-key");
  };
  const provider = new AmapPlaceProvider(
    new AmapWebServiceClient({
      apiKey: "secret-fixture-key",
      fetcher,
    }),
  );

  await assert.rejects(
    () =>
      provider.resolve(
        { input: { kind: "query", query: "杭州西湖" } },
        context,
      ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "UNAVAILABLE" &&
      error.cause === undefined &&
      !error.message.includes("secret-fixture-key") &&
      !error.message.includes("private network error"),
  );
});
