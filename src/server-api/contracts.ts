import type {
  RecommendationWarning,
  RouteScore,
  ScenicFeatures,
} from "../route-recommendation/models.ts";

export const SERVER_API_SCHEMA_VERSION = "1" as const;

export type ApiPlaceInput =
  | Readonly<{
      kind: "query";
      query: string;
    }>
  | Readonly<{
      kind: "point";
      longitude: number;
      latitude: number;
      crs: "WGS84";
      label?: string;
    }>;

export type PlanRoutesApiRequest = Readonly<{
  schemaVersion: "1";
  requestId?: string;
  start: ApiPlaceInput;
  mode: "running" | "cycling";
  targetDistanceMeters: number;
  preferences: Readonly<{
    greenery: number;
    waterfront: number;
    lowTraffic: number;
    comfort: number;
  }>;
  requiredStops?: readonly ApiPlaceInput[];
  maxResults?: number;
}>;

export type ApiProviderReference = Readonly<{
  providerId: string;
  externalId?: string;
}>;

export type ApiPlace = Readonly<{
  id: string;
  name: string;
  point: Readonly<{
    type: "Point";
    coordinates: readonly [number, number];
  }>;
  source: ApiProviderReference;
}>;

export type ApiRecommendedRoute = Readonly<{
  id: string;
  candidateId: string;
  geometry: Readonly<{
    type: "LineString";
    coordinates: readonly (readonly [number, number])[];
  }>;
  distanceMeters: number;
  durationSeconds: number | null;
  directionDegrees: number;
  source: ApiProviderReference;
  scenicFeatures: ScenicFeatures;
  score: RouteScore;
  delivery: Readonly<{
    policyId: string;
    policyVersion: string;
    exportFormats: readonly string[];
    navigationTargets: readonly string[];
    persistence: "allowed" | "metadata-only" | "denied";
    expiresAfterSeconds: number;
  }>;
}>;

export type PlanRoutesApiResponse = Readonly<{
  schemaVersion: "1";
  requestId: string;
  status: "complete" | "partial";
  start: ApiPlace;
  requiredStops: readonly ApiPlace[];
  routes: readonly ApiRecommendedRoute[];
  warnings: readonly RecommendationWarning[];
  diagnostics: Readonly<{
    generatedCandidateCount: number;
    routedCandidateCount: number;
    selectedRouteCount: number;
    sceneryDegraded: boolean;
    degradedSceneryRouteIds: readonly string[];
  }>;
}>;

export type ServerApiErrorResponse = Readonly<{
  schemaVersion: "1";
  requestId: string;
  error: Readonly<{
    code: string;
    retryable: boolean;
    details?: Readonly<
      Record<string, string | number | boolean>
    >;
  }>;
}>;
