import {
  gcj02Point,
  wgs84Point,
  type Wgs84Point,
} from "../../src/route-recommendation/coordinates.ts";
import type {
  RecommendationReason,
  RecommendationWarning,
  RouteCandidate,
  RoutedRoute,
  ScenicAnchor,
} from "../../src/route-recommendation/models.ts";
import type {
  CandidateGenerationStrategy,
  RouteSelectionStrategy,
} from "../../src/route-recommendation/strategies.ts";

const wgs84 = wgs84Point(120.149, 30.259);
const gcj02 = gcj02Point(120.153, 30.257);

const acceptedPoint: Wgs84Point = wgs84;
const acceptedCandidateOrigin: RouteCandidate["origin"] = wgs84;
const acceptedRouteGeometryPoint: RoutedRoute["geometry"][number] = wgs84;
const acceptedAnchorPoint: ScenicAnchor["point"] = wgs84;
const acceptedReason: RecommendationReason = {
  code: "DISTANCE_FIT",
  contribution: 80,
};
const acceptedWarning: RecommendationWarning = {
  code: "SCENERY_FEATURES_MISSING",
  params: { routeCount: 1 },
};
const acceptedCandidateStrategy: CandidateGenerationStrategy = () => [];
const acceptedSelectionStrategy: RouteSelectionStrategy = () => [];

// @ts-expect-error GCJ-02 must be converted before entering the route core.
const rejectedPoint: Wgs84Point = gcj02;
// @ts-expect-error Route candidates only accept normalized WGS-84 coordinates.
const rejectedCandidateOrigin: RouteCandidate["origin"] = gcj02;
// @ts-expect-error Routed geometry only accepts normalized WGS-84 coordinates.
const rejectedRouteGeometryPoint: RoutedRoute["geometry"][number] = gcj02;
// @ts-expect-error Scenic anchors only accept normalized WGS-84 coordinates.
const rejectedAnchorPoint: ScenicAnchor["point"] = gcj02;
const rejectedReason: RecommendationReason = {
  // @ts-expect-error Recommendation reason codes are a finite public contract.
  code: "ARBITRARY_REASON",
  contribution: 0,
};
const rejectedWarning: RecommendationWarning = {
  // @ts-expect-error Recommendation warning codes are a finite public contract.
  code: "ARBITRARY_WARNING",
};
const rejectedAsyncCandidateStrategy: CandidateGenerationStrategy =
  // @ts-expect-error Core candidate strategies cannot return an asynchronous result.
  async () => [];
const rejectedAsyncSelectionStrategy: RouteSelectionStrategy =
  // @ts-expect-error Core selection strategies cannot return an asynchronous result.
  async () => [];

void [
  acceptedPoint,
  acceptedCandidateOrigin,
  acceptedRouteGeometryPoint,
  acceptedAnchorPoint,
  acceptedReason,
  acceptedWarning,
  acceptedCandidateStrategy,
  acceptedSelectionStrategy,
  rejectedPoint,
  rejectedCandidateOrigin,
  rejectedRouteGeometryPoint,
  rejectedAnchorPoint,
  rejectedReason,
  rejectedWarning,
  rejectedAsyncCandidateStrategy,
  rejectedAsyncSelectionStrategy,
];
