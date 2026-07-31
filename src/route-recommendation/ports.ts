import type { Wgs84Point } from "./coordinates.ts";
import type {
  FindScenicRoutesRequest,
  PlaceInput,
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
  CandidateGenerationStrategy,
  RouteSelectionStrategy,
} from "./strategies.ts";

export type ProviderCallContext = Readonly<{
  requestId: string;
  signal?: AbortSignal;
  physicalCallBudget?: ProviderPhysicalCallBudget;
}>;

export interface ProviderPhysicalCallBudget {
  consume(providerId: string): void;
  remaining(): number;
}

export interface PlaceProvider {
  readonly id: string;

  resolve(
    request: Readonly<{
      input: PlaceInput;
      near?: Wgs84Point;
    }>,
    context: ProviderCallContext,
  ): Promise<ResolvedPlace>;
}

export interface RouteProvider {
  readonly id: string;

  getRoute(
    request: Readonly<{
      candidate: RouteCandidate;
      mode: TravelMode;
    }>,
    context: ProviderCallContext,
  ): Promise<RoutedRoute>;
}

export interface SceneryProvider {
  readonly id: string;

  findAnchors(
    request: Readonly<{
      origin: Wgs84Point;
      targetDistanceMeters: number;
      preferences: RoutePreferences;
      limit: number;
    }>,
    context: ProviderCallContext,
  ): Promise<readonly ScenicAnchor[]>;

  analyzeRoutes(
    request: Readonly<{
      routes: readonly RoutedRoute[];
      preferences: RoutePreferences;
    }>,
    context: ProviderCallContext,
  ): Promise<ReadonlyMap<string, ScenicFeatures>>;
}

export interface RouteScoringPolicy {
  readonly id: string;
  readonly version: string;

  score(input: Readonly<{
    route: RoutedRoute;
    scenicFeatures: ScenicFeatures;
    preferences: RoutePreferences;
    targetDistanceMeters: number;
  }>): RouteScore;
}

export type FindScenicRoutesLimits = Readonly<{
  maxCandidates: number;
  maxRouteProviderCalls: number;
  maxProviderHttpAttempts: number;
  maxConcurrentRouteRequests: number;
  maxSceneryAnchors: number;
  maxOverlapRatio: number;
}>;

export type FindScenicRoutesDependencies = Readonly<{
  placeProvider: PlaceProvider;
  routeProvider: RouteProvider;
  sceneryProvider: SceneryProvider;
  scoringPolicy: RouteScoringPolicy;
  candidateGenerationStrategy: CandidateGenerationStrategy;
  routeSelectionStrategy: RouteSelectionStrategy;
  signal?: AbortSignal;
  limits?: Partial<FindScenicRoutesLimits>;
}>;

export type FindScenicRoutes = (
  request: FindScenicRoutesRequest,
  dependencies: FindScenicRoutesDependencies,
) => Promise<import("./models.ts").FindScenicRoutesResult>;
