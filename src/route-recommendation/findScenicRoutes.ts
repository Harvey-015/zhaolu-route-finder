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
import {
  bearingDegrees,
  destinationPoint,
  distanceMeters,
  type Wgs84Point,
} from "./coordinates.ts";
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

const LOCAL_CANDIDATE_COUNT = 12;
const ESTIMATED_ROAD_FACTOR = 1.18;
const PRIMARY_DISTANCE_TOLERANCE = 0.15;
const RELAXED_DISTANCE_TOLERANCE = 0.25;
const REQUIRED_STOP_TOLERANCE_METERS = 80;

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

function polylineDistance(points: readonly Wgs84Point[]): number {
  return points.slice(1).reduce(
    (total, point, index) =>
      total + distanceMeters(points[index], point),
    0,
  );
}

function angularDifference(left: number, right: number): number {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

function candidateSignature(candidate: RouteCandidate): string {
  return candidate.waypoints
    .map(
      ({ longitude, latitude }) =>
        `${longitude.toFixed(5)},${latitude.toFixed(5)}`,
    )
    .join(";");
}

function preselectCandidates(
  candidates: readonly RouteCandidate[],
  scenicAnchors: readonly ScenicAnchor[],
  targetDistanceMeters: number,
  limit: number,
): RouteCandidate[] {
  const anchorRanks = new Map(
    scenicAnchors.map(({ id }, index) => [id, index]),
  );
  const uniqueCandidates = candidates.filter(
    (candidate, index, values) =>
      values.findIndex(
        (other) => candidateSignature(other) === candidateSignature(candidate),
      ) === index,
  );
  const ranked = uniqueCandidates
    .map((candidate) => {
      const estimatedRoadDistance =
        polylineDistance([
          candidate.origin,
          ...candidate.waypoints,
          candidate.destination,
        ]) * ESTIMATED_ROAD_FACTOR;
      const anchorRank = candidate.scenicAnchorIds
        .map((id) => anchorRanks.get(id))
        .find((rank): rank is number => rank !== undefined);
      const preferenceBonus =
        anchorRank === undefined
          ? 0
          : targetDistanceMeters *
            0.06 *
            (1 - anchorRank / Math.max(1, scenicAnchors.length));
      return {
        candidate,
        score:
          Math.abs(estimatedRoadDistance - targetDistanceMeters) -
          preferenceBonus,
      };
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.candidate.id.localeCompare(right.candidate.id),
    );
  const selected: typeof ranked = [];
  const reservedDirectionCount = Math.min(4, limit);
  const reservedDirections = Array.from(
    { length: reservedDirectionCount },
    (_, index) => (index * 360) / reservedDirectionCount,
  );

  for (const reservedDirection of reservedDirections) {
    const available = ranked.filter((entry) => !selected.includes(entry));
    const sectorWidth = 180 / reservedDirectionCount;
    const inSector = available.filter(
      ({ candidate }) =>
        angularDifference(
          candidate.directionDegrees,
          reservedDirection,
        ) <= sectorWidth,
    );
    const entry = (inSector.length > 0 ? inSector : available).sort(
      (left, right) =>
        angularDifference(
          left.candidate.directionDegrees,
          reservedDirection,
        ) -
          angularDifference(
            right.candidate.directionDegrees,
            reservedDirection,
          ) ||
        left.score - right.score ||
        left.candidate.id.localeCompare(right.candidate.id),
    )[0];
    if (entry) selected.push(entry);
  }

  for (const entry of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(entry)) selected.push(entry);
  }
  return selected.map(({ candidate }) => candidate);
}

function routeVisitsRequiredStops(
  route: RoutedRoute,
  candidate: RouteCandidate,
): boolean {
  let geometryIndex = 0;
  for (const { point } of candidate.requiredStops) {
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (
      let index = geometryIndex;
      index < route.geometry.length;
      index += 1
    ) {
      const distance = distanceMeters(route.geometry[index], point);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    if (
      closestIndex < 0 ||
      closestDistance > REQUIRED_STOP_TOLERANCE_METERS
    ) {
      return false;
    }
    geometryIndex = closestIndex;
  }
  return true;
}

function relativeDistanceDifference(
  route: RoutedRoute,
  targetDistanceMeters: number,
): number {
  return (
    Math.abs(route.distanceMeters - targetDistanceMeters) /
    targetDistanceMeters
  );
}

function refineCandidateDistance(
  candidate: RouteCandidate,
  actualDistanceMeters: number,
  targetDistanceMeters: number,
): RouteCandidate | null {
  const requiredPoints = candidate.requiredStops.map(({ point }) => point);
  const guidancePoints = candidate.waypoints.filter(
    (point) =>
      requiredPoints.every(
        (requiredPoint) => distanceMeters(point, requiredPoint) > 1,
      ),
  );
  if (guidancePoints.length === 0) return null;
  const scale = Math.max(
    0.55,
    Math.min(1.45, targetDistanceMeters / actualDistanceMeters),
  );
  return {
    ...candidate,
    id: `${candidate.id}:distance-refined`,
    waypoints: candidate.waypoints.map((point) => {
      if (
        requiredPoints.some(
          (requiredPoint) => distanceMeters(point, requiredPoint) <= 1,
        )
      ) {
        return point;
      }
      return destinationPoint(
        candidate.origin,
        distanceMeters(candidate.origin, point) * scale,
        bearingDegrees(candidate.origin, point),
      );
    }),
  };
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
  const localCandidateCount = Math.min(
    24,
    Math.max(LOCAL_CANDIDATE_COUNT, maxResults * 4),
  );
  let candidates: RouteCandidate[];
  try {
    const generatedCandidates = constrainCandidates(
      dependencies.candidateGenerationStrategy({
        requestId: request.requestId,
        origin: start.point,
        mode: request.mode,
        requiredStops,
        scenicAnchors,
        targetDistanceMeters: request.targetDistanceMeters,
        preferences: request.preferences,
        count: localCandidateCount,
      }),
      localCandidateCount,
    );
    const maximumLegCount = Math.max(
      1,
      ...generatedCandidates.map(({ waypoints }) => waypoints.length + 1),
    );
    const remainingHttpAttempts =
      context.physicalCallBudget?.remaining() ??
      limits.maxProviderHttpAttempts;
    const budgetCandidateCount = Math.max(
      1,
      Math.floor(remainingHttpAttempts / maximumLegCount),
    );
    const onlineCandidateBudget = Math.min(
      limits.maxCandidates,
      limits.maxRouteProviderCalls,
      budgetCandidateCount,
    );
    const fallbackCandidateCount = requiredStops.length > 0 ? 1 : 0;
    const onlineCandidateCount = scenicAnchors.length > 0
      ? onlineCandidateBudget
      : Math.min(
          maxResults + fallbackCandidateCount,
          onlineCandidateBudget,
        );
    candidates = preselectCandidates(
      generatedCandidates,
      scenicAnchors,
      request.targetDistanceMeters,
      onlineCandidateCount,
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
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
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

  const refinementSource = [...routedRoutes]
    .filter((route) => {
      const candidate = candidateById.get(route.candidateId);
      return (
        candidate !== undefined &&
        routeVisitsRequiredStops(route, candidate) &&
        relativeDistanceDifference(
          route,
          request.targetDistanceMeters,
        ) > RELAXED_DISTANCE_TOLERANCE
      );
    })
    .sort(
      (left, right) =>
        relativeDistanceDifference(
          left,
          request.targetDistanceMeters,
        ) -
        relativeDistanceDifference(
          right,
          request.targetDistanceMeters,
        ),
    )[0];
  if (refinementSource) {
    const sourceCandidate = candidateById.get(
      refinementSource.candidateId,
    );
    const refinedCandidate = sourceCandidate
      ? refineCandidateDistance(
          sourceCandidate,
          refinementSource.distanceMeters,
          request.targetDistanceMeters,
        )
      : null;
    const requiredAttempts = refinedCandidate
      ? refinedCandidate.waypoints.length + 1
      : Number.POSITIVE_INFINITY;
    if (
      refinedCandidate &&
      (context.physicalCallBudget?.remaining() ?? 0) >= requiredAttempts
    ) {
      try {
        const refinedRoute = await dependencies.routeProvider.getRoute(
          { candidate: refinedCandidate, mode: request.mode },
          context,
        );
        assertValidRoute(refinedRoute);
        candidateById.set(refinedCandidate.id, refinedCandidate);
        routedRoutes.push(refinedRoute);
      } catch (error) {
        warnings.push({
          code: "ROUTE_CANDIDATE_FAILED",
          params: {
            providerId:
              error instanceof ProviderError
                ? error.providerId
                : dependencies.routeProvider.id,
            candidateId: refinedCandidate.id,
          },
        });
      }
    }
  }
  throwIfAborted(dependencies.signal);

  const constraintValidRoutes = routedRoutes.filter((route) => {
    const candidate = candidateById.get(route.candidateId);
    return (
      candidate !== undefined &&
      routeVisitsRequiredStops(route, candidate) &&
      relativeDistanceDifference(route, request.targetDistanceMeters) <=
        RELAXED_DISTANCE_TOLERANCE
    );
  });
  if (constraintValidRoutes.length === 0) {
    throw new RouteRecommendationError({
      code: "NO_SUITABLE_ROUTE",
      retryable: false,
      details: {
        targetDistanceMeters: request.targetDistanceMeters,
        tolerancePercent: Math.round(
          RELAXED_DISTANCE_TOLERANCE * 100,
        ),
      },
    });
  }

  let featuresByRoute: ReadonlyMap<
    string,
    ReturnType<typeof unavailableScenicFeatures>
  > = new Map();
  const analysisAttempt = await settleWithin(
    dependencies.sceneryProvider.analyzeRoutes(
      {
        routes: constraintValidRoutes,
        preferences: request.preferences,
      },
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
  const scoredRoutes: RecommendedRoute[] = constraintValidRoutes.map((route) => {
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
  const relaxedDistanceRouteCount = selectedRoutes.filter(
    ({ route }) =>
      relativeDistanceDifference(
        route,
        request.targetDistanceMeters,
      ) > PRIMARY_DISTANCE_TOLERANCE,
  ).length;
  if (relaxedDistanceRouteCount > 0) {
    warnings.push({
      code: "DISTANCE_TOLERANCE_RELAXED",
      params: {
        routeCount: relaxedDistanceRouteCount,
        tolerancePercent: Math.round(
          RELAXED_DISTANCE_TOLERANCE * 100,
        ),
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
