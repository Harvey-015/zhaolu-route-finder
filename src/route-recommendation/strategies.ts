import type { Wgs84Point } from "./coordinates.ts";
import type {
  RecommendedRoute,
  ResolvedPlace,
  RouteCandidate,
  RoutePreferences,
  ScenicAnchor,
  TravelMode,
} from "./models.ts";

export type CandidateGenerationInput = Readonly<{
  requestId: string;
  origin: Wgs84Point;
  mode: TravelMode;
  requiredStops: readonly ResolvedPlace[];
  scenicAnchors: readonly ScenicAnchor[];
  targetDistanceMeters: number;
  preferences: RoutePreferences;
  count: number;
}>;

/**
 * Pure, synchronous candidate generation policy.
 *
 * External I/O belongs in providers; a candidate strategy only transforms
 * normalized route-core models into route intents.
 */
export type CandidateGenerationStrategy = (
  input: CandidateGenerationInput,
) => readonly RouteCandidate[];

export type RouteSelectionInput = Readonly<{
  routes: readonly RecommendedRoute[];
  limit: number;
  maxOverlapRatio: number;
}>;

/**
 * Pure, synchronous final selection policy.
 *
 * It receives already scored routes and must not call providers or depend on
 * presentation state.
 */
export type RouteSelectionStrategy = (
  input: RouteSelectionInput,
) => readonly RecommendedRoute[];
