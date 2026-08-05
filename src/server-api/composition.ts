import {
  AmapWebServiceClient,
} from "../adapters/amap/httpClient.ts";
import { AmapPlaceProvider } from "../adapters/amap/placeProvider.ts";
import { AmapRouteProvider } from "../adapters/amap/routeProvider.ts";
import { WorldCoverSceneryProvider } from "../adapters/worldcover/sceneryProvider.ts";
import { generateDirectionalCandidates } from "../route-recommendation/candidateGeneration.ts";
import { selectDiverseRoutes } from "../route-recommendation/diversity.ts";
import { findScenicRoutes } from "../route-recommendation/findScenicRoutes.ts";
import {
  defineRecommendationAlgorithm,
  type RecommendationAlgorithmProfile,
} from "../route-recommendation/algorithms.ts";
import type {
  FindScenicRoutesLimits,
  PlaceProvider,
  RouteProvider,
  SceneryProvider,
} from "../route-recommendation/ports.ts";
import { ScenicScoreV1 } from "../route-recommendation/scoring.ts";
import type { PlanScenicRoutes } from "./handler.ts";

export const defaultRecommendationAlgorithm =
  defineRecommendationAlgorithm({
    id: "scenic-route",
    version: "2",
    displayName: "风景环线推荐 v2",
    candidateGenerationStrategy: generateDirectionalCandidates,
    scoringPolicy: new ScenicScoreV1(),
    routeSelectionStrategy: selectDiverseRoutes,
  });

export type RoutePlannerOptions = Readonly<{
  placeProvider: PlaceProvider;
  routeProvider: RouteProvider;
  sceneryProvider: SceneryProvider;
  algorithm?: RecommendationAlgorithmProfile;
  limits?: Partial<FindScenicRoutesLimits>;
}>;

export function createRoutePlanner(
  options: RoutePlannerOptions,
): PlanScenicRoutes {
  const algorithm =
    options.algorithm ?? defaultRecommendationAlgorithm;
  return (request, signal) =>
    findScenicRoutes(request, {
      placeProvider: options.placeProvider,
      routeProvider: options.routeProvider,
      sceneryProvider: options.sceneryProvider,
      scoringPolicy: algorithm.scoringPolicy,
      candidateGenerationStrategy:
        algorithm.candidateGenerationStrategy,
      routeSelectionStrategy: algorithm.routeSelectionStrategy,
      signal,
      limits: options.limits,
    });
}

export type ProductionRoutePlannerOptions = Readonly<{
  amapWebServiceKey: string;
  amapCity?: string;
  amapMaxHttpAttemptsPerMinute?: number;
  sceneryProvider?: SceneryProvider;
  algorithm?: RecommendationAlgorithmProfile;
  limits?: Partial<FindScenicRoutesLimits>;
}>;

export function createProductionRoutePlanner(
  options: ProductionRoutePlannerOptions,
): PlanScenicRoutes {
  const client = new AmapWebServiceClient({
    apiKey: options.amapWebServiceKey,
    maxAttemptsPerMinute: options.amapMaxHttpAttemptsPerMinute,
  });
  const placeProvider = new AmapPlaceProvider(client, {
    city: options.amapCity,
  });
  const routeProvider = new AmapRouteProvider(client);
  const sceneryProvider =
    options.sceneryProvider ?? new WorldCoverSceneryProvider();

  return createRoutePlanner({
    placeProvider,
    routeProvider,
    sceneryProvider,
    algorithm: options.algorithm,
    limits: options.limits,
  });
}
