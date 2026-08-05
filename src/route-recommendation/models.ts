import type { Wgs84Point } from "./coordinates.ts";

export type TravelMode = "running" | "cycling";

export type PlaceInput =
  | Readonly<{
      kind: "query";
      query: string;
    }>
  | Readonly<{
      kind: "point";
      point: Wgs84Point;
      label?: string;
    }>;

export type ProviderReference = Readonly<{
  providerId: string;
  externalId?: string;
}>;

export type ResolvedPlace = Readonly<{
  id: string;
  name: string;
  point: Wgs84Point;
  source: ProviderReference;
}>;

export type RoutePreferences = Readonly<{
  greenery: number;
  waterfront: number;
  lowTraffic: number;
  comfort: number;
}>;

export type FindScenicRoutesRequest = Readonly<{
  requestId: string;
  start: PlaceInput;
  mode: TravelMode;
  targetDistanceMeters: number;
  preferences: RoutePreferences;
  requiredStops?: readonly PlaceInput[];
  maxResults?: number;
}>;

export type ScenicAnchor = Readonly<{
  id: string;
  point: Wgs84Point;
  label: string;
  source: ProviderReference;
}>;

export type RouteCandidate = Readonly<{
  id: string;
  origin: Wgs84Point;
  destination: Wgs84Point;
  waypoints: readonly Wgs84Point[];
  requiredStops: readonly ResolvedPlace[];
  scenicAnchorIds: readonly string[];
  directionDegrees: number;
  targetDistanceMeters: number;
}>;

export type RouteSegment = Readonly<{
  index: number;
  geometry: readonly Wgs84Point[];
  distanceMeters: number;
  durationSeconds: number | null;
}>;

export type RoutedRoute = Readonly<{
  id: string;
  candidateId: string;
  geometry: readonly Wgs84Point[];
  segments: readonly RouteSegment[];
  distanceMeters: number;
  durationSeconds: number | null;
  directionDegrees: number;
  source: ProviderReference;
}>;

export type FeatureMetric = Readonly<{
  value: number;
  confidence: number;
  source: ProviderReference;
  sourceVersion?: string;
}>;

export type ScenicFeatures = Readonly<{
  availability: "available" | "partial" | "unavailable";
  greenCoverage: FeatureMetric | null;
  waterfrontProximity: FeatureMetric | null;
  builtUpExposure: FeatureMetric | null;
  roadComfort: FeatureMetric | null;
}>;

export type RouteScoreDimensions = Readonly<{
  distanceFit: number;
  greenery: number;
  waterfront: number;
  lowTraffic: number;
  comfort: number;
}>;

export type RouteScorePenalties = Readonly<{
  excessiveDetour: number;
  builtUpExposure: number;
}>;

export type RecommendationParameters = Readonly<
  Record<string, string | number>
>;

export type RecommendationReasonCode =
  | "DISTANCE_FIT"
  | "GREENERY"
  | "WATERFRONT";

export type RecommendationReason = Readonly<{
  code: RecommendationReasonCode;
  params?: RecommendationParameters;
  contribution: number;
}>;

export type RouteScore = Readonly<{
  total: number;
  dimensions: RouteScoreDimensions;
  penalties: RouteScorePenalties;
  policyId: string;
  policyVersion: string;
  reasons: readonly RecommendationReason[];
}>;

export type RecommendedRoute = Readonly<{
  route: RoutedRoute;
  scenicFeatures: ScenicFeatures;
  score: RouteScore;
  reasons: readonly RecommendationReason[];
}>;

export type RecommendationWarningCode =
  | "SCENERY_ANCHORS_UNAVAILABLE"
  | "SCENERY_FEATURES_UNAVAILABLE"
  | "SCENERY_FEATURES_MISSING"
  | "ROUTE_CANDIDATE_FAILED"
  | "DISTANCE_TOLERANCE_RELAXED"
  | "RESULT_COUNT_REDUCED";

export type RecommendationWarning = Readonly<{
  code: RecommendationWarningCode;
  params?: RecommendationParameters;
}>;

export type FindScenicRoutesResult = Readonly<{
  requestId: string;
  status: "complete" | "partial";
  start: ResolvedPlace;
  requiredStops: readonly ResolvedPlace[];
  routes: readonly RecommendedRoute[];
  warnings: readonly RecommendationWarning[];
  diagnostics: Readonly<{
    generatedCandidateCount: number;
    routedCandidateCount: number;
    selectedRouteCount: number;
    sceneryDegraded: boolean;
    degradedSceneryRouteIds: readonly string[];
  }>;
}>;

export function unavailableScenicFeatures(): ScenicFeatures {
  return {
    availability: "unavailable",
    greenCoverage: null,
    waterfrontProximity: null,
    builtUpExposure: null,
    roadComfort: null,
  };
}
