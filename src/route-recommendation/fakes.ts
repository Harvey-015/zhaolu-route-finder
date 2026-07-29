import { distanceMeters, type Wgs84Point } from "./coordinates.ts";
import {
  ProviderError,
  throwIfAborted,
  type ProviderErrorCode,
} from "./errors.ts";
import type {
  FeatureMetric,
  PlaceInput,
  RecommendationReason,
  ResolvedPlace,
  RouteCandidate,
  RoutePreferences,
  RouteScore,
  RoutedRoute,
  ScenicAnchor,
  ScenicFeatures,
  TravelMode,
} from "./models.ts";
import type {
  PlaceProvider,
  ProviderCallContext,
  RouteProvider,
  RouteScoringPolicy,
  SceneryProvider,
} from "./ports.ts";

function queryKey(input: PlaceInput) {
  return input.kind === "query"
    ? input.query.trim()
    : `${input.point.longitude},${input.point.latitude}`;
}

export class FakePlaceProvider implements PlaceProvider {
  readonly id = "fake-place";
  readonly calls: Array<{ input: PlaceInput; near?: Wgs84Point }> = [];
  readonly signals: Array<AbortSignal | undefined> = [];
  private readonly places: ReadonlyMap<string, ResolvedPlace>;

  constructor(places: Readonly<Record<string, ResolvedPlace>> = {}) {
    this.places = new Map(Object.entries(places));
  }

  async resolve(
    request: Readonly<{ input: PlaceInput; near?: Wgs84Point }>,
    context: ProviderCallContext,
  ): Promise<ResolvedPlace> {
    throwIfAborted(context.signal);
    this.signals.push(context.signal);
    this.calls.push(request);
    if (request.input.kind === "point") {
      return {
        id: `fake-point:${queryKey(request.input)}`,
        name: request.input.label ?? "Selected point",
        point: request.input.point,
        source: { providerId: this.id },
      };
    }

    const place = this.places.get(queryKey(request.input));
    if (!place) {
      throw new ProviderError({
        providerId: this.id,
        code: "NOT_FOUND",
        message: `Fake place not found: ${request.input.query}`,
      });
    }
    return place;
  }
}

export type FakeRouteFactory = (
  candidate: RouteCandidate,
  mode: TravelMode,
) => RoutedRoute;

type FakeRouteProviderOptions = Readonly<{
  routeFactory?: FakeRouteFactory;
  failureForCandidate?: (
    candidate: RouteCandidate,
  ) => ProviderErrorCode | undefined;
}>;

export class FakeRouteProvider implements RouteProvider {
  readonly id = "fake-route";
  readonly calls: Array<{ candidate: RouteCandidate; mode: TravelMode }> = [];
  readonly signals: Array<AbortSignal | undefined> = [];
  private readonly options: FakeRouteProviderOptions;

  constructor(options: FakeRouteProviderOptions = {}) {
    this.options = options;
  }

  async getRoute(
    request: Readonly<{
      candidate: RouteCandidate;
      mode: TravelMode;
    }>,
    context: ProviderCallContext,
  ): Promise<RoutedRoute> {
    throwIfAborted(context.signal);
    this.signals.push(context.signal);
    this.calls.push(request);

    const failure = this.options.failureForCandidate?.(request.candidate);
    if (failure) {
      throw new ProviderError({
        providerId: this.id,
        code: failure,
        message: `Fake route failure for ${request.candidate.id}`,
      });
    }
    if (this.options.routeFactory) {
      return this.options.routeFactory(request.candidate, request.mode);
    }

    const geometry = [
      request.candidate.origin,
      ...request.candidate.waypoints,
      request.candidate.destination,
    ];
    const routeDistance = geometry
      .slice(1)
      .reduce(
        (sum, point, index) =>
          sum + distanceMeters(geometry[index], point),
        0,
      );
    const speedMetersPerSecond =
      request.mode === "cycling" ? 5.5 : 2.4;

    return {
      id: `${this.id}:${request.candidate.id}`,
      candidateId: request.candidate.id,
      geometry,
      segments: [
        {
          index: 0,
          geometry,
          distanceMeters: routeDistance,
          durationSeconds: Math.round(
            routeDistance / speedMetersPerSecond,
          ),
        },
      ],
      distanceMeters: routeDistance,
      durationSeconds: Math.round(routeDistance / speedMetersPerSecond),
      directionDegrees: request.candidate.directionDegrees,
      source: {
        providerId: this.id,
        externalId: request.candidate.id,
      },
    };
  }
}

function metric(
  value: number,
  providerId: string,
): FeatureMetric {
  return {
    value,
    confidence: 1,
    source: { providerId },
    sourceVersion: "fake-v1",
  };
}

export class FakeSceneryProvider implements SceneryProvider {
  readonly id = "fake-scenery";
  readonly anchorCalls: string[] = [];
  readonly analysisCalls: string[][] = [];
  readonly anchorSignals: Array<AbortSignal | undefined> = [];
  readonly analysisSignals: Array<AbortSignal | undefined> = [];
  private readonly options: Readonly<{
    anchors?: readonly ScenicAnchor[];
    failAnchors?: boolean;
    failAnalysis?: boolean;
    featuresForRoute?: (route: RoutedRoute) => ScenicFeatures;
  }>;

  constructor(
    options: Readonly<{
      anchors?: readonly ScenicAnchor[];
      failAnchors?: boolean;
      failAnalysis?: boolean;
      featuresForRoute?: (route: RoutedRoute) => ScenicFeatures;
    }> = {},
  ) {
    this.options = options;
  }

  async findAnchors(
    request: Readonly<{
      origin: Wgs84Point;
      targetDistanceMeters: number;
      preferences: RoutePreferences;
      limit: number;
    }>,
    context: ProviderCallContext,
  ): Promise<readonly ScenicAnchor[]> {
    throwIfAborted(context.signal);
    this.anchorSignals.push(context.signal);
    this.anchorCalls.push(context.requestId);
    if (this.options.failAnchors) {
      throw new ProviderError({
        providerId: this.id,
        code: "UNAVAILABLE",
        message: "Fake scenery anchors are unavailable",
      });
    }
    return (this.options.anchors ?? []).slice(0, request.limit);
  }

  async analyzeRoutes(
    request: Readonly<{
      routes: readonly RoutedRoute[];
      preferences: RoutePreferences;
    }>,
    context: ProviderCallContext,
  ): Promise<ReadonlyMap<string, ScenicFeatures>> {
    throwIfAborted(context.signal);
    this.analysisSignals.push(context.signal);
    this.analysisCalls.push(request.routes.map(({ id }) => id));
    if (this.options.failAnalysis) {
      throw new ProviderError({
        providerId: this.id,
        code: "UNAVAILABLE",
        message: "Fake scenery analysis is unavailable",
      });
    }

    return new Map(
      request.routes.map((route, index) => [
        route.id,
        this.options.featuresForRoute?.(route) ?? {
          availability: "available" as const,
          greenCoverage: metric(
            Math.max(0, 0.8 - index * 0.08),
            this.id,
          ),
          waterfrontProximity: metric(
            Math.max(0, 0.7 - index * 0.06),
            this.id,
          ),
          builtUpExposure: metric(
            Math.min(1, 0.15 + index * 0.05),
            this.id,
          ),
          roadComfort: metric(
            Math.max(0, 0.75 - index * 0.04),
            this.id,
          ),
        },
      ]),
    );
  }
}

export class DeterministicScoringPolicy
  implements RouteScoringPolicy
{
  readonly id = "fake-deterministic-score";
  readonly version = "1";

  score(input: Readonly<{
    route: RoutedRoute;
    scenicFeatures: ScenicFeatures;
    preferences: RoutePreferences;
    targetDistanceMeters: number;
  }>): RouteScore {
    const distanceFit = Math.max(
      0,
      100 -
        (Math.abs(
          input.route.distanceMeters - input.targetDistanceMeters,
        ) /
          input.targetDistanceMeters) *
          100,
    );
    const greenery =
      (input.scenicFeatures.greenCoverage?.value ?? 0) * 100;
    const waterfront =
      (input.scenicFeatures.waterfrontProximity?.value ?? 0) * 100;
    const lowTraffic =
      (1 - (input.scenicFeatures.builtUpExposure?.value ?? 1)) * 100;
    const comfort =
      (input.scenicFeatures.roadComfort?.value ?? 0) * 100;
    const preferenceTotal = Math.max(
      1,
      input.preferences.greenery +
        input.preferences.waterfront +
        input.preferences.lowTraffic +
        input.preferences.comfort,
    );
    const preferenceScore =
      (greenery * input.preferences.greenery +
        waterfront * input.preferences.waterfront +
        lowTraffic * input.preferences.lowTraffic +
        comfort * input.preferences.comfort) /
      preferenceTotal;
    const builtUpPenalty =
      (input.scenicFeatures.builtUpExposure?.value ?? 0) * 10;
    const total = Math.max(
      0,
      Math.min(100, distanceFit * 0.35 + preferenceScore * 0.65 - builtUpPenalty),
    );
    const reasons: RecommendationReason[] = [
      {
        code: "DISTANCE_FIT",
        contribution: distanceFit,
      },
    ];
    if (greenery >= 60) {
      reasons.push({
        code: "GREENERY",
        contribution: greenery,
      });
    }
    if (waterfront >= 60) {
      reasons.push({
        code: "WATERFRONT",
        contribution: waterfront,
      });
    }

    return {
      total,
      dimensions: {
        distanceFit,
        greenery,
        waterfront,
        lowTraffic,
        comfort,
      },
      penalties: {
        excessiveDetour: Math.max(0, 100 - distanceFit),
        builtUpExposure: builtUpPenalty,
      },
      policyId: this.id,
      policyVersion: this.version,
      reasons,
    };
  }
}
