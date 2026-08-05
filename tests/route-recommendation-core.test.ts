import assert from "node:assert/strict";
import test from "node:test";
import {
  defineRecommendationAlgorithm,
  RecommendationAlgorithmRegistry,
} from "../src/route-recommendation/algorithms.ts";
import {
  bearingDegrees,
  destinationPoint,
  distanceMeters,
  wgs84Point,
} from "../src/route-recommendation/coordinates.ts";
import {
  ProviderError,
  RouteRecommendationError,
} from "../src/route-recommendation/errors.ts";
import { generateDirectionalCandidates } from "../src/route-recommendation/candidateGeneration.ts";
import {
  DeterministicScoringPolicy,
  FakePlaceProvider,
  FakeRouteProvider,
  FakeSceneryProvider,
} from "../src/route-recommendation/fakes.ts";
import { findScenicRoutes } from "../src/route-recommendation/findScenicRoutes.ts";
import { selectDiverseRoutes } from "../src/route-recommendation/diversity.ts";
import { unavailableScenicFeatures } from "../src/route-recommendation/models.ts";
import type {
  FindScenicRoutesRequest,
  RecommendedRoute,
  ResolvedPlace,
  RoutedRoute,
} from "../src/route-recommendation/models.ts";
import type {
  RouteProvider,
  RouteScoringPolicy,
  SceneryProvider,
} from "../src/route-recommendation/ports.ts";
import type {
  CandidateGenerationStrategy,
  RouteSelectionStrategy,
} from "../src/route-recommendation/strategies.ts";

const startPoint = wgs84Point(120.149, 30.259);

const startPlace: ResolvedPlace = {
  id: "place:west-lake",
  name: "杭州西湖",
  point: startPoint,
  source: { providerId: "fake-place", externalId: "west-lake" },
};

const defaultStrategies = {
  candidateGenerationStrategy: generateDirectionalCandidates,
  routeSelectionStrategy: selectDiverseRoutes,
} as const;

function request(
  overrides: Partial<FindScenicRoutesRequest> = {},
): FindScenicRoutesRequest {
  return {
    requestId: "request-001",
    start: { kind: "query", query: "杭州西湖" },
    mode: "running",
    targetDistanceMeters: 10_000,
    preferences: {
      greenery: 0.8,
      waterfront: 1,
      lowTraffic: 0.4,
      comfort: 0.6,
    },
    maxResults: 3,
    ...overrides,
  };
}

function dependencies(routeProvider = new FakeRouteProvider()) {
  return {
    placeProvider: new FakePlaceProvider({ "杭州西湖": startPlace }),
    routeProvider,
    sceneryProvider: new FakeSceneryProvider(),
    scoringPolicy: new DeterministicScoringPolicy(),
    ...defaultStrategies,
  };
}

function constantScoringPolicy(): RouteScoringPolicy {
  return {
    id: "constant-score",
    version: "1",
    score: () => ({
      total: 80,
      dimensions: {
        distanceFit: 80,
        greenery: 80,
        waterfront: 80,
        lowTraffic: 80,
        comfort: 80,
      },
      penalties: {
        excessiveDetour: 0,
        builtUpExposure: 0,
      },
      policyId: "constant-score",
      policyVersion: "1",
      reasons: [{ code: "DISTANCE_FIT", contribution: 80 }],
    }),
  };
}

test("recommendation algorithms are registered as versioned profiles", () => {
  const profile = defineRecommendationAlgorithm({
    id: "example-scenic",
    version: "2",
    displayName: "Example scenic v2",
    candidateGenerationStrategy: generateDirectionalCandidates,
    scoringPolicy: constantScoringPolicy(),
    routeSelectionStrategy: selectDiverseRoutes,
  });
  const registry = new RecommendationAlgorithmRegistry([profile]);

  assert.deepEqual(registry.require("example-scenic", "2"), profile);
  assert.deepEqual(registry.ids(), ["example-scenic@2"]);
  assert.throws(
    () => registry.require("missing", "1"),
    /RECOMMENDATION_ALGORITHM_NOT_REGISTERED/,
  );
  assert.throws(
    () => new RecommendationAlgorithmRegistry([profile, profile]),
    /RECOMMENDATION_ALGORITHM_DUPLICATE/,
  );
});

function equallyScoredRoute(id: string, longitudeOffset: number): RecommendedRoute {
  const geometry = [
    wgs84Point(120 + longitudeOffset, 30),
    wgs84Point(120.01 + longitudeOffset, 30.01),
  ];
  return {
    route: {
      id,
      candidateId: `candidate:${id}`,
      geometry,
      segments: [
        {
          index: 0,
          geometry,
          distanceMeters: 1_500,
          durationSeconds: 600,
        },
      ],
      distanceMeters: 1_500,
      durationSeconds: 600,
      directionDegrees: 0,
      source: { providerId: "fake-route" },
    },
    scenicFeatures: unavailableScenicFeatures(),
    score: {
      total: 80,
      dimensions: {
        distanceFit: 80,
        greenery: 80,
        waterfront: 80,
        lowTraffic: 80,
        comfort: 80,
      },
      penalties: {
        excessiveDetour: 0,
        builtUpExposure: 0,
      },
      policyId: "same-score",
      policyVersion: "1",
      reasons: [],
    },
    reasons: [],
  };
}

test("constructs type-safe WGS-84 points and deterministic destinations", () => {
  const destination = destinationPoint(startPoint, 1_000, 90);

  assert.equal(startPoint.crs, "WGS84");
  assert.equal(destination.crs, "WGS84");
  assert.ok(Math.abs(distanceMeters(startPoint, destination) - 1_000) < 1);
  assert.throws(() => wgs84Point(181, 30), RangeError);
});

test("centers generated guidance around the requested direction", () => {
  const [candidate] = generateDirectionalCandidates({
    requestId: "north-guidance",
    origin: startPoint,
    mode: "running",
    requiredStops: [],
    scenicAnchors: [],
    targetDistanceMeters: 10_000,
    preferences: request().preferences,
    count: 1,
  });

  assert.equal(candidate.directionDegrees, 0);
  assert.equal(candidate.waypoints.length, 2);
  assert.ok(bearingDegrees(startPoint, candidate.waypoints[0]) > 300);
  assert.ok(bearingDegrees(startPoint, candidate.waypoints[1]) < 60);
});

test("uses route id as a stable tie-breaker for equally scored routes", () => {
  const selected = selectDiverseRoutes({
    routes: [
      equallyScoredRoute("route-z", 0),
      equallyScoredRoute("route-a", 1),
      equallyScoredRoute("route-m", 2),
    ],
    limit: 3,
    maxOverlapRatio: 0.82,
  });

  assert.deepEqual(
    selected.map(({ route }) => route.id),
    ["route-a", "route-m", "route-z"],
  );
});

test("returns three deterministic routes using only fake providers", async () => {
  const fakeDependencies = dependencies();
  const result = await findScenicRoutes(request(), fakeDependencies);

  assert.equal(result.requestId, "request-001");
  assert.equal(result.status, "partial");
  assert.equal(result.routes.length, 3);
  assert.equal(result.diagnostics.sceneryDegraded, false);
  assert.deepEqual(result.diagnostics.degradedSceneryRouteIds, []);
  assert.equal(
    result.warnings.some(({ code }) => code === "SCENERY_FEATURES_MISSING"),
    false,
  );
  assert.equal(
    result.warnings.some(
      ({ code }) => code === "DISTANCE_TOLERANCE_RELAXED",
    ),
    true,
  );
  assert.equal(result.diagnostics.generatedCandidateCount, 3);
  assert.equal(result.diagnostics.routedCandidateCount, 3);
  assert.equal(fakeDependencies.routeProvider.calls.length, 3);
  assert.ok(
    result.routes.every(
      ({ route, scenicFeatures }) =>
        route.geometry.every(({ crs }) => crs === "WGS84") &&
        scenicFeatures.availability === "available",
    ),
  );
  assert.ok(
    result.routes
      .flatMap(({ reasons }) => reasons)
      .every((reason) => !("message" in reason)),
  );
});

test("reserves a north candidate and one fallback when a required stop is present", async () => {
  const requiredPoint = destinationPoint(startPoint, 800, 315);
  const routeProvider = new FakeRouteProvider();
  const result = await findScenicRoutes(
    request({
      start: { kind: "point", point: startPoint, label: "Start" },
      requiredStops: [
        { kind: "point", point: requiredPoint, label: "Required" },
      ],
    }),
    {
      ...dependencies(routeProvider),
      placeProvider: new FakePlaceProvider(),
    },
  );

  assert.equal(result.routes.length, 3);
  assert.equal(routeProvider.calls.length, 4);
  assert.deepEqual(
    routeProvider.calls
      .map(({ candidate }) => candidate.directionDegrees)
      .sort((left, right) => left - right),
    [0, 90, 180, 270],
  );
});

test("uses an injected candidate generation strategy", async () => {
  let receivedMode = "";
  let receivedCount = 0;
  const candidateGenerationStrategy: CandidateGenerationStrategy = (input) => {
    receivedMode = input.mode;
    receivedCount = input.count;
    return generateDirectionalCandidates({ ...input, count: 2 }).map(
      (candidate, index) => ({
        ...candidate,
        id: `custom-candidate-${index + 1}`,
      }),
    );
  };
  const routeProvider = new FakeRouteProvider();

  const result = await findScenicRoutes(request({ maxResults: 2 }), {
    ...dependencies(routeProvider),
    candidateGenerationStrategy,
  });

  assert.equal(receivedMode, "running");
  assert.equal(receivedCount, 12);
  assert.deepEqual(
    routeProvider.calls.map(({ candidate }) => candidate.id).sort(),
    ["custom-candidate-1", "custom-candidate-2"],
  );
  assert.equal(result.diagnostics.generatedCandidateCount, 2);
  assert.equal(result.routes.length, 2);
});

test("uses an injected route selection strategy and enforces maxResults", async () => {
  let receivedLimit = 0;
  const routeProvider = new FakeRouteProvider();
  const routeSelectionStrategy: RouteSelectionStrategy = (input) => {
    receivedLimit = input.limit;
    return [...input.routes].reverse();
  };

  const result = await findScenicRoutes(request({ maxResults: 2 }), {
    ...dependencies(routeProvider),
    routeSelectionStrategy,
  });

  assert.equal(receivedLimit, 2);
  assert.equal(result.routes.length, 2);
  assert.deepEqual(
    result.routes.map(({ route }) => route.candidateId),
    routeProvider.calls
      .map(({ candidate }) => candidate.id)
      .reverse()
      .slice(0, 2),
  );
});

test("maps an unknown candidate strategy failure to a safe INTERNAL_ERROR", async () => {
  const originalError = new Error("secret candidate algorithm detail");

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        candidateGenerationStrategy: () => {
          throw originalError;
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof RouteRecommendationError);
      assert.equal(error.code, "INTERNAL_ERROR");
      assert.equal(error.message, "INTERNAL_ERROR");
      assert.equal(error.message.includes(originalError.message), false);
      assert.equal(error.cause, originalError);
      return true;
    },
  );
});

test("rejects routes invented by an injected selection strategy", async () => {
  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        routeSelectionStrategy: () => [
          equallyScoredRoute("invented-route", 10),
        ],
      }),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "INTERNAL_ERROR" &&
      error.message === "INTERNAL_ERROR",
  );
});

test("maps selection strategy cancellation to REQUEST_ABORTED", async () => {
  const abortError = new Error("private selection cancellation detail");
  abortError.name = "AbortError";

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        routeSelectionStrategy: () => {
          throw abortError;
        },
      }),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "REQUEST_ABORTED" &&
      error.message === "REQUEST_ABORTED",
  );
});

test("maps start-place resolution failure to PLACE_NOT_FOUND", async () => {
  await assert.rejects(
    () =>
      findScenicRoutes(
        request({ start: { kind: "query", query: "missing start" } }),
        dependencies(),
      ),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "PLACE_NOT_FOUND",
  );
});

test("maps required-stop resolution failure to PLACE_NOT_FOUND", async () => {
  await assert.rejects(
    () =>
      findScenicRoutes(
        request({
          requiredStops: [{ kind: "query", query: "missing stop" }],
        }),
        dependencies(),
      ),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "PLACE_NOT_FOUND",
  );
});

test("fills the result count with distinct routes that share a compulsory segment", () => {
  const shared = Array.from({ length: 9 }, (_, index) =>
    wgs84Point(120 + index * 0.001, 30),
  );
  const first = equallyScoredRoute("shared-a", 0);
  const second = equallyScoredRoute("shared-b", 0);
  const routes = [
    {
      ...first,
      route: {
        ...first.route,
        geometry: [...shared, wgs84Point(120.009, 30)],
      },
    },
    {
      ...second,
      route: {
        ...second.route,
        geometry: [...shared, wgs84Point(120.009, 30.01)],
      },
    },
  ];

  const selected = selectDiverseRoutes({
    routes,
    limit: 2,
    maxOverlapRatio: 0.82,
  });

  assert.equal(selected.length, 2);
});

test("keeps required stops in order while inserting guidance at the cheapest gap", () => {
  const firstStop = {
    id: "stop-1",
    name: "第一站",
    point: destinationPoint(startPoint, 1_000, 90),
    source: { providerId: "fixture-place" },
  } satisfies ResolvedPlace;
  const secondStop = {
    id: "stop-2",
    name: "第二站",
    point: destinationPoint(startPoint, 1_000, 180),
    source: { providerId: "fixture-place" },
  } satisfies ResolvedPlace;
  const candidates = generateDirectionalCandidates({
    requestId: "ordered-stops",
    origin: startPoint,
    mode: "running",
    requiredStops: [firstStop, secondStop],
    scenicAnchors: [],
    targetDistanceMeters: 10_000,
    preferences: request().preferences,
    count: 3,
  });

  candidates.forEach(({ waypoints }) => {
    const firstIndex = waypoints.indexOf(firstStop.point);
    const secondIndex = waypoints.indexOf(secondStop.point);
    assert.ok(firstIndex >= 0);
    assert.ok(secondIndex > firstIndex);
  });
});

test("marks routes between fifteen and twenty-five percent off target as relaxed", async () => {
  const routeProvider = new FakeRouteProvider({
    routeFactory: (candidate): RoutedRoute => ({
      id: `relaxed:${candidate.id}`,
      candidateId: candidate.id,
      geometry: [candidate.origin, ...candidate.waypoints, candidate.destination],
      segments: [],
      distanceMeters: 12_000,
      durationSeconds: 4_000,
      directionDegrees: candidate.directionDegrees,
      source: { providerId: "fake-route" },
    }),
  });

  const result = await findScenicRoutes(request(), dependencies(routeProvider));

  assert.ok(result.routes.length > 0);
  assert.ok(
    result.warnings.some(
      ({ code }) => code === "DISTANCE_TOLERANCE_RELAXED",
    ),
  );
});

test("rejects routes outside the twenty-five percent distance boundary", async () => {
  const routeProvider = new FakeRouteProvider({
    routeFactory: (candidate): RoutedRoute => ({
      id: `too-long:${candidate.id}`,
      candidateId: candidate.id,
      geometry: [candidate.origin, ...candidate.waypoints, candidate.destination],
      segments: [],
      distanceMeters: 14_000,
      durationSeconds: 4_000,
      directionDegrees: candidate.directionDegrees,
      source: { providerId: "fake-route" },
    }),
  });

  await assert.rejects(
    () => findScenicRoutes(request(), dependencies(routeProvider)),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "NO_SUITABLE_ROUTE",
  );
});

test("rejects provider geometry that does not visit a required stop", async () => {
  const requiredPlace = {
    id: "required-place",
    name: "必经公园",
    point: destinationPoint(startPoint, 1_000, 90),
    source: { providerId: "fake-place" },
  } satisfies ResolvedPlace;
  const routeProvider = new FakeRouteProvider({
    routeFactory: (candidate): RoutedRoute => ({
      id: `missing-stop:${candidate.id}`,
      candidateId: candidate.id,
      geometry: [
        candidate.origin,
        destinationPoint(candidate.origin, 100, 180),
        candidate.destination,
      ],
      segments: [],
      distanceMeters: 10_000,
      durationSeconds: 4_000,
      directionDegrees: candidate.directionDegrees,
      source: { providerId: "fake-route" },
    }),
  });

  await assert.rejects(
    () =>
      findScenicRoutes(
        request({
          requiredStops: [{ kind: "query", query: "必经公园" }],
        }),
        {
          ...dependencies(routeProvider),
          placeProvider: new FakePlaceProvider({
            "杭州西湖": startPlace,
            "必经公园": requiredPlace,
          }),
        },
      ),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "NO_SUITABLE_ROUTE",
  );
});

test("keeps a partial result when individual route candidates fail", async () => {
  let candidateCall = 0;
  const routeProvider = new FakeRouteProvider({
    failureForCandidate: () => {
      candidateCall += 1;
      return candidateCall > 1 ? "UNAVAILABLE" : undefined;
    },
  });
  const result = await findScenicRoutes(request(), {
    ...dependencies(routeProvider),
    limits: {
      maxCandidates: 3,
      maxRouteProviderCalls: 3,
    },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.routes.length, 1);
  assert.equal(result.diagnostics.routedCandidateCount, 1);
  assert.equal(
    result.warnings.filter(({ code }) => code === "ROUTE_CANDIDATE_FAILED")
      .length,
    2,
  );
  assert.ok(
    result.warnings.some(({ code }) => code === "RESULT_COUNT_REDUCED"),
  );
  assert.ok(result.warnings.every((warning) => !("message" in warning)));
});

test("degrades cleanly when scenery anchors and analysis are unavailable", async () => {
  const result = await findScenicRoutes(request(), {
    ...defaultStrategies,
    placeProvider: new FakePlaceProvider({ "杭州西湖": startPlace }),
    routeProvider: new FakeRouteProvider(),
    sceneryProvider: new FakeSceneryProvider({
      failAnchors: true,
      failAnalysis: true,
    }),
    scoringPolicy: new DeterministicScoringPolicy(),
  });

  assert.equal(result.status, "partial");
  assert.equal(result.routes.length, 3);
  assert.equal(result.diagnostics.sceneryDegraded, true);
  assert.ok(
    result.routes.every(
      ({ scenicFeatures }) =>
        scenicFeatures.availability === "unavailable",
    ),
  );
  assert.ok(
    result.warnings.some(
      ({ code }) => code === "SCENERY_ANCHORS_UNAVAILABLE",
    ),
  );
  assert.ok(
    result.warnings.some(
      ({ code }) => code === "SCENERY_FEATURES_UNAVAILABLE",
    ),
  );
});

test("returns routes within soft scenery wait budgets", async () => {
  const never = () => new Promise<never>(() => {});
  const startedAt = Date.now();
  const result = await findScenicRoutes(request(), {
    ...dependencies(),
    sceneryProvider: {
      id: "slow-scenery",
      findAnchors: never,
      analyzeRoutes: never,
    },
    limits: {
      maxSceneryAnchorWaitMs: 5,
      maxSceneryAnalysisWaitMs: 5,
    },
  });

  assert.ok(Date.now() - startedAt < 250);
  assert.equal(result.routes.length, 3);
  assert.equal(result.status, "partial");
  assert.ok(
    result.warnings.some(
      ({ code }) => code === "SCENERY_ANCHORS_UNAVAILABLE",
    ),
  );
  assert.ok(
    result.warnings.some(
      ({ code }) => code === "SCENERY_FEATURES_UNAVAILABLE",
    ),
  );
});

test("returns a partial route with diagnostics when scenery features are missing", async () => {
  const completeScenery = new FakeSceneryProvider();
  let omittedRouteId = "";
  const incompleteScenery: SceneryProvider = {
    id: "fake-incomplete-scenery",
    findAnchors: (input, context) =>
      completeScenery.findAnchors(input, context),
    analyzeRoutes: async (input, context) => {
      const features = new Map(
        await completeScenery.analyzeRoutes(input, context),
      );
      omittedRouteId = input.routes[0].id;
      features.delete(omittedRouteId);
      return features;
    },
  };
  const result = await findScenicRoutes(request(), {
    ...dependencies(),
    sceneryProvider: incompleteScenery,
    scoringPolicy: constantScoringPolicy(),
  });

  assert.equal(result.status, "partial");
  assert.ok(result.routes.some(({ route }) => route.id === omittedRouteId));
  assert.equal(result.diagnostics.sceneryDegraded, true);
  assert.deepEqual(
    result.diagnostics.degradedSceneryRouteIds,
    [omittedRouteId],
  );
  const missingFeaturesWarning = result.warnings.find(
    ({ code }) => code === "SCENERY_FEATURES_MISSING",
  );
  assert.deepEqual(missingFeaturesWarning?.params, { routeCount: 1 });
  assert.equal("message" in (missingFeaturesWarning ?? {}), false);
  assert.equal(
    result.routes.find(({ route }) => route.id === omittedRouteId)
      ?.scenicFeatures.availability,
    "unavailable",
  );
});

test("maps an all-candidate timeout to a stable application error", async () => {
  const routeProvider = new FakeRouteProvider({
    failureForCandidate: () => "TIMEOUT",
  });

  await assert.rejects(
    () => findScenicRoutes(request(), dependencies(routeProvider)),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "ROUTE_PROVIDER_TIMEOUT" &&
      error.retryable,
  );
});

test("maps non-timeout route-provider exhaustion to NO_SUITABLE_ROUTE", async () => {
  const routeProvider = new FakeRouteProvider({
    failureForCandidate: () => "UNAVAILABLE",
  });

  await assert.rejects(
    () => findScenicRoutes(request(), dependencies(routeProvider)),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "NO_SUITABLE_ROUTE" &&
      error.retryable,
  );
});

test("maps an unknown scoring failure to a safe INTERNAL_ERROR", async () => {
  const originalError = new Error("secret scoring implementation detail");

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        scoringPolicy: {
          id: "throwing-score",
          version: "1",
          score: () => {
            throw originalError;
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof RouteRecommendationError);
      assert.equal(error.code, "INTERNAL_ERROR");
      assert.equal(error.message, "INTERNAL_ERROR");
      assert.equal(error.message.includes(originalError.message), false);
      assert.equal(error.stack?.includes(originalError.message), false);
      assert.equal(error.cause, originalError);
      return true;
    },
  );
});

test("maps a scoring AbortError to REQUEST_ABORTED", async () => {
  const abortError = new Error("cancelled scoring detail");
  abortError.name = "AbortError";

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        scoringPolicy: {
          id: "aborting-score",
          version: "1",
          score: () => {
            throw abortError;
          },
        },
      }),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "REQUEST_ABORTED" &&
      error.message === "REQUEST_ABORTED",
  );
});

test("preserves a known application error from the scoring policy", async () => {
  const knownError = new RouteRecommendationError({
    code: "CONFIGURATION_ERROR",
    details: { field: "scoringPolicy" },
  });

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        scoringPolicy: {
          id: "known-error-score",
          version: "1",
          score: () => {
            throw knownError;
          },
        },
      }),
    (error: unknown) => error === knownError,
  );
});

test("removes routes whose normalized geometry is effectively identical", async () => {
  const fixedGeometry = [
    startPoint,
    wgs84Point(120.159, 30.269),
    wgs84Point(120.169, 30.259),
    startPoint,
  ];
  const fixedDistance = fixedGeometry
    .slice(1)
    .reduce(
      (sum, point, index) =>
        sum + distanceMeters(fixedGeometry[index], point),
      0,
    );
  const routeProvider = new FakeRouteProvider({
    routeFactory: (candidate): RoutedRoute => ({
      id: `fixed:${candidate.id}`,
      candidateId: candidate.id,
      geometry: fixedGeometry,
      segments: [
        {
          index: 0,
          geometry: fixedGeometry,
          distanceMeters: 10_000,
          durationSeconds: 3_600,
        },
      ],
      distanceMeters: 10_000,
      durationSeconds: 3_600,
      directionDegrees: candidate.directionDegrees,
      source: { providerId: "fake-route" },
    }),
  });
  const result = await findScenicRoutes(request(), dependencies(routeProvider));

  assert.equal(result.routes.length, 1);
  assert.ok(
    result.warnings.some(({ code }) => code === "RESULT_COUNT_REDUCED"),
  );
});

test("a candidate strategy cannot exceed the route-provider call budget", async () => {
  const routeProvider = new FakeRouteProvider();
  const candidateGenerationStrategy: CandidateGenerationStrategy = (input) =>
    generateDirectionalCandidates({ ...input, count: 8 });
  const result = await findScenicRoutes(
    request({ maxResults: 2 }),
    {
      ...dependencies(routeProvider),
      candidateGenerationStrategy,
      limits: {
        maxCandidates: 5,
        maxRouteProviderCalls: 2,
        maxConcurrentRouteRequests: 1,
      },
    },
  );

  assert.equal(routeProvider.calls.length, 2);
  assert.equal(result.diagnostics.generatedCandidateCount, 2);
});

test("never exceeds the configured route-provider concurrency", async () => {
  const baseRouteProvider = new FakeRouteProvider();
  let activeCalls = 0;
  let peakCalls = 0;
  const routeProvider: RouteProvider = {
    id: "concurrency-recording-route",
    getRoute: async (input, context) => {
      activeCalls += 1;
      peakCalls = Math.max(peakCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        return await baseRouteProvider.getRoute(input, context);
      } finally {
        activeCalls -= 1;
      }
    },
  };

  await findScenicRoutes(request({ maxResults: 5 }), {
    ...defaultStrategies,
    placeProvider: new FakePlaceProvider({ "杭州西湖": startPlace }),
    routeProvider,
    sceneryProvider: new FakeSceneryProvider(),
    scoringPolicy: new DeterministicScoringPolicy(),
    limits: {
      maxCandidates: 5,
      maxRouteProviderCalls: 5,
      maxConcurrentRouteRequests: 2,
    },
  });

  assert.equal(baseRouteProvider.calls.length, 5);
  assert.equal(peakCalls, 2);
});

test("passes the caller AbortSignal to every provider call", async () => {
  const controller = new AbortController();
  const fakeDependencies = dependencies();

  await findScenicRoutes(request(), {
    ...fakeDependencies,
    signal: controller.signal,
  });

  assert.ok(
    fakeDependencies.placeProvider.signals.every(
      (signal) => signal === controller.signal,
    ),
  );
  assert.ok(
    fakeDependencies.routeProvider.signals.every(
      (signal) => signal === controller.signal,
    ),
  );
  assert.ok(
    fakeDependencies.sceneryProvider.anchorSignals.every(
      (signal) => signal === controller.signal,
    ),
  );
  assert.ok(
    fakeDependencies.sceneryProvider.analysisSignals.every(
      (signal) => signal === controller.signal,
    ),
  );
});

test("propagates cancellation as REQUEST_ABORTED", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...dependencies(),
        signal: controller.signal,
      }),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "REQUEST_ABORTED",
  );
});

test("stops before route planning when an in-flight request is cancelled", async () => {
  const controller = new AbortController();
  const placeProvider = new FakePlaceProvider({
    "杭州西湖": startPlace,
  });
  const routeProvider = new FakeRouteProvider();

  await assert.rejects(
    () =>
      findScenicRoutes(request(), {
        ...defaultStrategies,
        placeProvider: {
          id: placeProvider.id,
          resolve: async (input, context) => {
            const place = await placeProvider.resolve(input, context);
            controller.abort();
            return place;
          },
        },
        routeProvider,
        sceneryProvider: new FakeSceneryProvider(),
        scoringPolicy: new DeterministicScoringPolicy(),
        signal: controller.signal,
      }),
    (error: unknown) =>
      error instanceof RouteRecommendationError &&
      error.code === "REQUEST_ABORTED",
  );
  assert.equal(routeProvider.calls.length, 0);
});

test("does not leak provider errors through the stable result contract", async () => {
  const routeProvider = new FakeRouteProvider({
    failureForCandidate: () => "QUOTA_EXCEEDED",
  });

  await assert.rejects(
    () => findScenicRoutes(request(), dependencies(routeProvider)),
    (error: unknown) => {
      assert.ok(error instanceof RouteRecommendationError);
      assert.equal(error.code, "ROUTE_PROVIDER_QUOTA_EXCEEDED");
      assert.equal(error instanceof ProviderError, false);
      return true;
    },
  );
});
