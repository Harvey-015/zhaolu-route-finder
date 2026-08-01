import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CogWorldCoverRasterSource } from "../src/adapters/worldcover/cogSource.ts";
import type {
  WorldCoverGrid,
  WorldCoverGridRequest,
  WorldCoverRasterSource,
} from "../src/adapters/worldcover/rasterSource.ts";
import { WorldCoverSceneryProvider } from "../src/adapters/worldcover/sceneryProvider.ts";
import { wgs84Point } from "../src/route-recommendation/coordinates.ts";
import { ProviderError } from "../src/route-recommendation/errors.ts";
import type { RoutedRoute } from "../src/route-recommendation/models.ts";
import type { ProviderCallContext } from "../src/route-recommendation/ports.ts";

const preferences = {
  greenery: 1,
  waterfront: 1,
  lowTraffic: 1,
  comfort: 1,
} as const;
const context = { requestId: "worldcover-fixture-request" } as const;

type FixtureGrid = Readonly<{
  bounds: WorldCoverGrid["bounds"];
  width: number;
  height: number;
  values: readonly number[];
}>;

async function fixtureGrid(): Promise<WorldCoverGrid> {
  const contents = await readFile(
    new URL(
      "./fixtures/worldcover/synthetic-grid.json",
      import.meta.url,
    ),
    "utf8",
  );
  const fixture = JSON.parse(contents) as FixtureGrid;
  return {
    bounds: fixture.bounds,
    width: fixture.width,
    height: fixture.height,
    values: Uint8Array.from(fixture.values),
  };
}

class FixtureRasterSource implements WorldCoverRasterSource {
  readonly calls: Array<{
    request: WorldCoverGridRequest;
    context: ProviderCallContext;
  }> = [];
  private readonly grid: WorldCoverGrid;

  constructor(grid: WorldCoverGrid) {
    this.grid = grid;
  }

  async readGrid(
    request: WorldCoverGridRequest,
    callContext: ProviderCallContext,
  ): Promise<WorldCoverGrid> {
    this.calls.push({ request, context: callContext });
    return this.grid;
  }
}

function route(
  id: string,
  longitude: number,
  startLatitude: number,
  endLatitude: number,
): RoutedRoute {
  const geometry = [
    wgs84Point(longitude, startLatitude),
    wgs84Point(longitude, endLatitude),
  ];
  return {
    id,
    candidateId: `candidate-${id}`,
    geometry,
    segments: [
      {
        index: 0,
        geometry,
        distanceMeters: 450,
        durationSeconds: 180,
      },
    ],
    distanceMeters: 450,
    durationSeconds: 180,
    directionDegrees: 0,
    source: { providerId: "fixture-route" },
  };
}

test("builds all intersecting ESA 3-degree tile URLs with fixed-width coordinates", async () => {
  const calls: URL[] = [];
  const source = new CogWorldCoverRasterSource({
    tileReader: async ({ url }) => {
      calls.push(url);
      return new Uint8Array(4).fill(
        url.pathname.includes("N00E003") ? 10 : 0,
      );
    },
  });

  const grid = await source.readGrid(
    {
      bounds: {
        minLongitude: 2.99,
        minLatitude: -0.01,
        maxLongitude: 3.01,
        maxLatitude: 0.01,
      },
      width: 2,
      height: 2,
    },
    context,
  );

  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map(({ pathname }) => pathname.split("/").at(-1)).sort(),
    [
      "ESA_WorldCover_10m_2021_v200_N00E000_Map.tif",
      "ESA_WorldCover_10m_2021_v200_N00E003_Map.tif",
      "ESA_WorldCover_10m_2021_v200_S03E000_Map.tif",
      "ESA_WorldCover_10m_2021_v200_S03E003_Map.tif",
    ],
  );
  assert.deepEqual([...grid.values], [10, 10, 10, 10]);
});

test("caches identical raster windows until the configured TTL expires", async () => {
  let reads = 0;
  let now = 1_000;
  const source = new CogWorldCoverRasterSource({
    cacheTtlMs: 100,
    now: () => now,
    tileReader: async () => {
      reads += 1;
      return new Uint8Array([10]);
    },
  });
  const request = {
    bounds: {
      minLongitude: 120,
      minLatitude: 30,
      maxLongitude: 120.01,
      maxLatitude: 30.01,
    },
    width: 1,
    height: 1,
  } as const;

  await source.readGrid(request, { requestId: "cache-first" });
  await source.readGrid(request, { requestId: "cache-second" });
  assert.equal(reads, 1);

  now += 101;
  await source.readGrid(request, { requestId: "cache-expired" });
  assert.equal(reads, 2);
});

test("rejects malformed or unknown WorldCover raster values", async () => {
  const wrongLength = new CogWorldCoverRasterSource({
    tileReader: async () => new Uint8Array([10]),
  });
  await assert.rejects(
    wrongLength.readGrid(
      {
        bounds: {
          minLongitude: 120,
          minLatitude: 30,
          maxLongitude: 120.01,
          maxLatitude: 30.01,
        },
        width: 2,
        height: 2,
      },
      context,
    ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "INVALID_RESPONSE" &&
      error.message === "WORLDCOVER_INVALID_RESPONSE",
  );

  const unknownClass = new CogWorldCoverRasterSource({
    tileReader: async () => new Uint8Array([17]),
  });
  await assert.rejects(
    unknownClass.readGrid(
      {
        bounds: {
          minLongitude: 120,
          minLatitude: 30,
          maxLongitude: 120.01,
          maxLatitude: 30.01,
        },
        width: 1,
        height: 1,
      },
      context,
    ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "INVALID_RESPONSE",
  );
});

test("maps timeout and caller cancellation to stable provider errors", async () => {
  const waitForAbort = ({ signal }: { signal: AbortSignal }) =>
    new Promise<Uint8Array>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(signal.reason),
        { once: true },
      );
    });
  const timeoutSource = new CogWorldCoverRasterSource({
    timeoutMs: 10,
    tileReader: waitForAbort,
  });
  const request = {
    bounds: {
      minLongitude: 120,
      minLatitude: 30,
      maxLongitude: 120.01,
      maxLatitude: 30.01,
    },
    width: 1,
    height: 1,
  } as const;

  await assert.rejects(
    timeoutSource.readGrid(request, context),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "TIMEOUT" &&
      error.retryable,
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    timeoutSource.readGrid(request, {
      requestId: "cancelled",
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "ABORTED" &&
      !error.retryable,
  );
});

test("finds deterministic land anchors from green and waterfront classes", async () => {
  const source = new FixtureRasterSource(await fixtureGrid());
  const provider = new WorldCoverSceneryProvider({
    rasterSource: source,
  });
  const controller = new AbortController();

  const anchors = await provider.findAnchors(
    {
      origin: wgs84Point(120.006, 30.006),
      targetDistanceMeters: 5_000,
      preferences,
      limit: 4,
    },
    {
      requestId: "anchors",
      signal: controller.signal,
    },
  );
  const repeated = await provider.findAnchors(
    {
      origin: wgs84Point(120.006, 30.006),
      targetDistanceMeters: 5_000,
      preferences,
      limit: 4,
    },
    { requestId: "anchors-repeated" },
  );

  assert.equal(source.calls.length, 2);
  assert.equal(source.calls[0].context.signal, controller.signal);
  assert.equal(anchors.length, 4);
  assert.ok(anchors.every(({ point }) => point.crs === "WGS84"));
  assert.ok(
    anchors.every(
      ({ source: anchorSource }) =>
        anchorSource.providerId === "worldcover-scenery" &&
        anchorSource.externalId !== "class-80",
    ),
  );
  assert.deepEqual(
    anchors.map(({ id }) => id),
    repeated.map(({ id }) => id),
  );
});

test("converts raster classes into partial scenic features for every route", async () => {
  const source = new FixtureRasterSource(await fixtureGrid());
  const provider = new WorldCoverSceneryProvider({
    rasterSource: source,
  });
  const greenRoute = route(
    "green",
    120.002,
    30.004,
    30.008,
  );
  const builtRoute = route(
    "built",
    120.01,
    30.004,
    30.008,
  );
  const uncoveredRoute = route(
    "uncovered",
    121,
    30.004,
    30.008,
  );

  const features = await provider.analyzeRoutes(
    {
      routes: [greenRoute, builtRoute, uncoveredRoute],
      preferences,
    },
    context,
  );

  assert.equal(source.calls.length, 1);
  assert.equal(features.size, 3);
  const green = features.get("green");
  const built = features.get("built");
  const uncovered = features.get("uncovered");
  assert.equal(green?.availability, "partial");
  assert.equal(green?.greenCoverage?.value, 1);
  assert.equal(green?.builtUpExposure?.value, 0);
  assert.ok((green?.waterfrontProximity?.value ?? 0) > 0);
  assert.equal(green?.roadComfort, null);
  assert.equal(
    green?.greenCoverage?.sourceVersion,
    "2021-v200",
  );
  assert.equal(
    green?.greenCoverage?.source.providerId,
    "worldcover-scenery",
  );
  assert.equal(built?.availability, "partial");
  assert.equal(built?.greenCoverage?.value, 0);
  assert.equal(built?.builtUpExposure?.value, 1);
  assert.deepEqual(uncovered, {
    availability: "unavailable",
    greenCoverage: null,
    waterfrontProximity: null,
    builtUpExposure: null,
    roadComfort: null,
  });
});

test("reuses one request grid for anchors and route analysis", async () => {
  const source = new FixtureRasterSource(await fixtureGrid());
  const provider = new WorldCoverSceneryProvider({
    rasterSource: source,
  });
  const sharedContext = { requestId: "shared-grid-request" } as const;

  await provider.findAnchors(
    {
      origin: wgs84Point(120.006, 30.006),
      targetDistanceMeters: 5_000,
      preferences,
      limit: 4,
    },
    sharedContext,
  );
  const features = await provider.analyzeRoutes(
    {
      routes: [route("shared", 120.002, 30.004, 30.008)],
      preferences,
    },
    sharedContext,
  );

  assert.equal(source.calls.length, 1);
  assert.equal(features.get("shared")?.availability, "partial");
});

test("does not read a raster when there are no routes", async () => {
  const source = new FixtureRasterSource(await fixtureGrid());
  const provider = new WorldCoverSceneryProvider({
    rasterSource: source,
  });

  const features = await provider.analyzeRoutes(
    { routes: [], preferences },
    context,
  );

  assert.equal(features.size, 0);
  assert.equal(source.calls.length, 0);
});

test("preserves stable raster-source failures for core-level degradation", async () => {
  let reads = 0;
  const rasterSource: WorldCoverRasterSource = {
    async readGrid() {
      reads += 1;
      throw new ProviderError({
        providerId: "worldcover-scenery",
        code: "UNAVAILABLE",
        message: "WORLDCOVER_SERVICE_UNAVAILABLE",
      });
    },
  };
  const provider = new WorldCoverSceneryProvider({ rasterSource });

  await assert.rejects(
    provider.findAnchors(
      {
        origin: wgs84Point(120.006, 30.006),
        targetDistanceMeters: 5_000,
        preferences,
        limit: 4,
      },
      context,
    ),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === "UNAVAILABLE" &&
      error.message === "WORLDCOVER_SERVICE_UNAVAILABLE",
  );
  await assert.rejects(
    provider.analyzeRoutes(
      {
        routes: [route("failed-grid", 120.002, 30.004, 30.008)],
        preferences,
      },
      context,
    ),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "UNAVAILABLE",
  );
  assert.equal(reads, 1);
});
