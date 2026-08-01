import {
  ProviderError,
  RouteRecommendationError,
  throwIfAborted,
} from "./errors.ts";
import {
  unavailableScenicFeatures,
  type FindScenicRoutesRequest,
  type FindScenicRoutesResult,
  type RecommendationWarning,
  type RecommendedRoute,
  type ResolvedPlace,
  type RouteCandidate,
  type RoutedRoute,
  type ScenicAnchor,
} from "./models.ts";
import type {
  FindScenicRoutesDependencies,
  FindScenicRoutesLimits,
  ProviderCallContext,
} from "./ports.ts";
import { createProviderPhysicalCallBudget } from "./providerBudget.ts";

const DEFAULT_LIMITS: FindScenicRoutesLimits = {
  maxCandidates: 6,
  maxRouteProviderCalls: 6,
  maxProviderHttpAttempts: 24,
  maxConcurrentRouteRequests: 3,
  maxSceneryAnchors: 24,
  maxSceneryAnchorWaitMs: 1_500,
  maxSceneryAnalysisWaitMs: 1_500,
  maxOverlapRatio: 0.82,
};

function validateWeight(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RouteRecommendationError({
      code: "INVALID_REQUEST",
      details: { field: name, minimum: 0, maximum: 1 },
    });
  }
}

export function validateFindScenicRoutesRequest(
  request: FindScenicRoutesRequest,
) {
  if (!request.requestId.trim()) {
    throw new RouteRecommendationError({
      code: "INVALID_REQUEST",
      details: { field: "requestId" },
    });
  }
  if (
    !Number.isFinite(request.targetDistanceMeters) ||
    request.targetDistanceMeters < 500 ||
    request.targetDistanceMeters > 200_000
  ) {
    throw new RouteRecommendationError({
      code: "INVALID_REQUEST",
      details: {
        field: "targetDistanceMeters",
        minimum: 500,
        maximum: 200_000,
      },
    });
  }
  if (
    request.maxResults !== undefined &&
    (!Number.isInteger(request.maxResults) ||
      request.maxResults < 1 ||
      request.maxResults > 5)
  ) {
    throw new RouteRecommendationError({
      code: "INVALID_REQUEST",
      details: { field: "maxResults", minimum: 1, maximum: 5 },
    });
  }
  if ((request.requiredStops?.length ?? 0) > 3) {
    throw new RouteRecommendationError({
      code: "INVALID_REQUEST",
      details: { field: "requiredStops", maximum: 3 },
    });
  }

  Object.entries(request.preferences).forEach(([name, value]) =>
    validateWeight(`preferences.${name}`, value),
  );
}

function normalizeLimits(
  overrides: FindScenicRoutesDependencies["limits"],
): FindScenicRoutesLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const integerKeys = [
    "maxCandidates",
    "maxRouteProviderCalls",
    "maxProviderHttpAttempts",
    "maxConcurrentRouteRequests",
    "maxSceneryAnchors",
    "maxSceneryAnchorWaitMs",
    "maxSceneryAnalysisWaitMs",
  ] as const;
  integerKeys.forEach((key) => {
    if (!Number.isInteger(limits[key]) || limits[key] < 1) {
      throw new RouteRecommendationError({
        code: "CONFIGURATION_ERROR",
        details: { field: key, minimum: 1 },
      });
    }
  });
  if (
    !Number.isFinite(limits.maxOverlapRatio) ||
    limits.maxOverlapRatio <= 0 ||
    limits.maxOverlapRatio > 1
  ) {
    throw new RouteRecommendationError({
      code: "CONFIGURATION_ERROR",
      details: {
        field: "maxOverlapRatio",
        minimumExclusive: 0,
        maximum: 1,
      },
    });
  }
  return limits;
}

function mapPlaceError(error: unknown): RouteRecommendationError {
  if (error instanceof RouteRecommendationError) return error;
  if (error instanceof ProviderError && error.code === "NOT_FOUND") {
    return new RouteRecommendationError({
      code: "PLACE_NOT_FOUND",
      cause: error,
    });
  }
  if (error instanceof ProviderError && error.code === "ABORTED") {
    return new RouteRecommendationError({
      code: "REQUEST_ABORTED",
      cause: error,
    });
  }
  return new RouteRecommendationError({
    code: "PLACE_PROVIDER_UNAVAILABLE",
    retryable: error instanceof ProviderError ? error.retryable : true,
    cause: error,
  });
}

function routeFailureError(
  failures: readonly unknown[],
): RouteRecommendationError {
  const providerErrors = failures.filter(
    (error): error is ProviderError => error instanceof ProviderError,
  );
  if (
    providerErrors.length > 0 &&
    providerErrors.every(({ code }) => code === "QUOTA_EXCEEDED")
  ) {
    return new RouteRecommendationError({
      code: "ROUTE_PROVIDER_QUOTA_EXCEEDED",
      retryable: false,
    });
  }
  if (
    providerErrors.length > 0 &&
    providerErrors.every(({ code }) => code === "TIMEOUT")
  ) {
    return new RouteRecommendationError({
      code: "ROUTE_PROVIDER_TIMEOUT",
      retryable: true,
    });
  }
  return new RouteRecommendationError({
    code: "NO_SUITABLE_ROUTE",
    retryable: providerErrors.some(({ retryable }) => retryable),
  });
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function mapCoreAlgorithmError(
  error: unknown,
  signal?: AbortSignal,
): RouteRecommendationError {
  throwIfAborted(signal);
  if (error instanceof RouteRecommendationError) return error;
  if (
    isAbortError(error) ||
    (error instanceof ProviderError && error.code === "ABORTED")
  ) {
    return new RouteRecommendationError({
      code: "REQUEST_ABORTED",
      cause: error,
    });
  }
  return new RouteRecommendationError({
    code: "INTERNAL_ERROR",
    cause: error,
  });
}

function constrainCandidates(
  generatedCandidates: readonly RouteCandidate[],
  limit: number,
): RouteCandidate[] {
  const candidates = [...generatedCandidates].slice(0, limit);
  const candidateIds = new Set<string>();
  candidates.forEach(({ id }) => {
    if (!id.trim() || candidateIds.has(id)) {
      throw new Error("Candidate strategy returned an invalid candidate id");
    }
    candidateIds.add(id);
  });
  return candidates;
}

function constrainSelectedRoutes(
  proposedRoutes: readonly RecommendedRoute[],
  scoredRoutes: readonly RecommendedRoute[],
  limit: number,
): RecommendedRoute[] {
  const allowedRoutes = new Map(
    scoredRoutes.map((route) => [route.route.id, route]),
  );
  const selectedRoutes: RecommendedRoute[] = [];
  const selectedRouteIds = new Set<string>();

  for (const proposedRoute of proposedRoutes) {
    const routeId = proposedRoute.route.id;
    const canonicalRoute = allowedRoutes.get(routeId);
    if (!canonicalRoute) {
      throw new Error("Selection strategy returned an unknown route");
    }
    if (selectedRouteIds.has(routeId)) continue;
    selectedRouteIds.add(routeId);
    selectedRoutes.push(canonicalRoute);
    if (selectedRoutes.length >= limit) break;
  }

  return selectedRoutes;
}

async function mapSettledWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input, index: number) => Promise<Output>,
) {
  const results: PromiseSettledResult<Output>[] = new Array(inputs.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await operation(inputs[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      () => worker(),
    ),
  );
  return results;
}

type SoftWaitResult<T> =
  | PromiseSettledResult<T>
  | Readonly<{ status: "timed-out" }>;

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<SoftWaitResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Readonly<{ status: "timed-out" }>>(
    (resolve) => {
      timeout = setTimeout(
        () => resolve({ status: "timed-out" }),
        timeoutMs,
      );
    },
  );
  const settled: Promise<PromiseSettledResult<T>> = promise.then(
    (value): PromiseFulfilledResult<T> => ({
      status: "fulfilled",
      value,
    }),
    (reason: unknown): PromiseRejectedResult => ({
      status: "rejected",
      reason,
    }),
  );
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function assertValidRoute(route: RoutedRoute) {
  if (
    route.geometry.length < 2 ||
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters <= 0
  ) {
    throw new ProviderError({
      providerId: route.source.providerId,
      code: "INVALID_RESPONSE",
      message: "Route provider returned an invalid normalized route",
    });
  }
}

async function resolveRequiredStops(
  request: FindScenicRoutesRequest,
  start: ResolvedPlace,
  dependencies: FindScenicRoutesDependencies,
  context: ProviderCallContext,
) {
  try {
    return await Promise.all(
      (request.requiredStops ?? []).map((input) =>
        dependencies.placeProvider.resolve(
          { input, near: start.point },
          context,
        ),
      ),
    );
  } catch (error) {
    throw mapPlaceError(error);
  }
}

export async function findScenicRoutes(
  request: FindScenicRoutesRequest,
  dependencies: FindScenicRoutesDependencies,
): Promise<FindScenicRoutesResult> {
  validateFindScenicRoutesRequest(request);
  const limits = normalizeLimits(dependencies.limits);
  const context: ProviderCallContext = {
    requestId: request.requestId,
    signal: dependencies.signal,
    physicalCallBudget: createProviderPhysicalCallBudget(
      limits.maxProviderHttpAttempts,
    ),
  };
  const warnings: RecommendationWarning[] = [];
  throwIfAborted(dependencies.signal);

  let start: ResolvedPlace;
  try {
    start = await dependencies.placeProvider.resolve(
      { input: request.start },
      context,
    );
  } catch (error) {
    throw mapPlaceError(error);
  }
  throwIfAborted(dependencies.signal);

  const requiredStops = await resolveRequiredStops(
    request,
    start,
    dependencies,
    context,
  );
  throwIfAborted(dependencies.signal);

  let scenicAnchors: ScenicAnchor[] = [];
  const anchorAttempt = await settleWithin(
    dependencies.sceneryProvider.findAnchors(
      {
        origin: start.point,
        targetDistanceMeters: request.targetDistanceMeters,
        preferences: request.preferences,
        limit: limits.maxSceneryAnchors,
      },
      context,
    ),
    limits.maxSceneryAnchorWaitMs,
  );
  if (anchorAttempt.status === "fulfilled") {
    scenicAnchors = [...anchorAttempt.value];
  } else {
    throwIfAborted(dependencies.signal);
    warnings.push({
      code: "SCENERY_ANCHORS_UNAVAILABLE",
      params: {
        providerId:
          anchorAttempt.status === "rejected" &&
          anchorAttempt.reason instanceof ProviderError
            ? anchorAttempt.reason.providerId
            : dependencies.sceneryProvider.id,
      },
    });
  }

  const maxResults = request.maxResults ?? 3;
  const candidateCount = Math.min(
    limits.maxCandidates,
    limits.maxRouteProviderCalls,
    maxResults,
  );
  let candidates: RouteCandidate[];
  try {
    candidates = constrainCandidates(
      dependencies.candidateGenerationStrategy({
        requestId: request.requestId,
        origin: start.point,
        mode: request.mode,
        requiredStops,
        scenicAnchors,
        targetDistanceMeters: request.targetDistanceMeters,
        preferences: request.preferences,
        count: candidateCount,
      }),
      candidateCount,
    );
  } catch (error) {
    throw mapCoreAlgorithmError(error, dependencies.signal);
  }
  throwIfAborted(dependencies.signal);
  const routeAttempts = await mapSettledWithConcurrency(
    candidates,
    limits.maxConcurrentRouteRequests,
    async (candidate) => {
      throwIfAborted(dependencies.signal);
      const route = await dependencies.routeProvider.getRoute(
        { candidate, mode: request.mode },
        context,
      );
      assertValidRoute(route);
      return route;
    },
  );
  throwIfAborted(dependencies.signal);

  const routedRoutes: RoutedRoute[] = [];
  const routeFailures: unknown[] = [];
  routeAttempts.forEach((attempt, index) => {
    if (attempt.status === "fulfilled") {
      routedRoutes.push(attempt.value);
      return;
    }
    routeFailures.push(attempt.reason);
    warnings.push({
      code: "ROUTE_CANDIDATE_FAILED",
      params: {
        providerId:
          attempt.reason instanceof ProviderError
            ? attempt.reason.providerId
            : dependencies.routeProvider.id,
        candidateId: candidates[index].id,
      },
    });
  });
  if (routedRoutes.length === 0) {
    throw routeFailureError(routeFailures);
  }

  let featuresByRoute: ReadonlyMap<
    string,
    ReturnType<typeof unavailableScenicFeatures>
  > = new Map();
  const analysisAttempt = await settleWithin(
    dependencies.sceneryProvider.analyzeRoutes(
      { routes: routedRoutes, preferences: request.preferences },
      context,
    ),
    limits.maxSceneryAnalysisWaitMs,
  );
  if (analysisAttempt.status === "fulfilled") {
    featuresByRoute = analysisAttempt.value;
  } else {
    throwIfAborted(dependencies.signal);
    warnings.push({
      code: "SCENERY_FEATURES_UNAVAILABLE",
      params: {
        providerId:
          analysisAttempt.status === "rejected" &&
          analysisAttempt.reason instanceof ProviderError
            ? analysisAttempt.reason.providerId
            : dependencies.sceneryProvider.id,
      },
    });
  }

  const degradedSceneryRouteIds = new Set<string>();
  const scoredRoutes: RecommendedRoute[] = routedRoutes.map((route) => {
    const providedScenicFeatures = featuresByRoute.get(route.id);
    const scenicFeatures =
      providedScenicFeatures ?? unavailableScenicFeatures();
    if (
      !providedScenicFeatures ||
      scenicFeatures.availability === "unavailable"
    ) {
      degradedSceneryRouteIds.add(route.id);
    }
    let score;
    try {
      score = dependencies.scoringPolicy.score({
        route,
        scenicFeatures,
        preferences: request.preferences,
        targetDistanceMeters: request.targetDistanceMeters,
      });
    } catch (error) {
      throw mapCoreAlgorithmError(error, dependencies.signal);
    }
    return {
      route,
      scenicFeatures,
      score,
      reasons: score.reasons,
    };
  });

  let selectedRoutes: RecommendedRoute[];
  try {
    selectedRoutes = constrainSelectedRoutes(
      dependencies.routeSelectionStrategy({
        routes: scoredRoutes,
        limit: maxResults,
        maxOverlapRatio: limits.maxOverlapRatio,
      }),
      scoredRoutes,
      maxResults,
    );
  } catch (error) {
    throw mapCoreAlgorithmError(error, dependencies.signal);
  }
  throwIfAborted(dependencies.signal);
  if (selectedRoutes.length < maxResults) {
    warnings.push({
      code: "RESULT_COUNT_REDUCED",
      params: {
        requestedCount: maxResults,
        actualCount: selectedRoutes.length,
      },
    });
  }
  const selectedDegradedSceneryRouteIds = selectedRoutes
    .map(({ route }) => route.id)
    .filter((routeId) => degradedSceneryRouteIds.has(routeId));
  if (selectedDegradedSceneryRouteIds.length > 0) {
    warnings.push({
      code: "SCENERY_FEATURES_MISSING",
      params: { routeCount: selectedDegradedSceneryRouteIds.length },
    });
  }

  return {
    requestId: request.requestId,
    status: warnings.length > 0 ? "partial" : "complete",
    start,
    requiredStops,
    routes: selectedRoutes,
    warnings,
    diagnostics: {
      generatedCandidateCount: candidates.length,
      routedCandidateCount: routedRoutes.length,
      selectedRouteCount: selectedRoutes.length,
      sceneryDegraded: selectedDegradedSceneryRouteIds.length > 0,
      degradedSceneryRouteIds: selectedDegradedSceneryRouteIds,
    },
  };
}
