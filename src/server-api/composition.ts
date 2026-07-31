import {
  AmapWebServiceClient,
} from "../adapters/amap/httpClient.ts";
import { AmapPlaceProvider } from "../adapters/amap/placeProvider.ts";
import { AmapRouteProvider } from "../adapters/amap/routeProvider.ts";
import { WorldCoverSceneryProvider } from "../adapters/worldcover/sceneryProvider.ts";
import { generateDirectionalCandidates } from "../route-recommendation/candidateGeneration.ts";
import { selectDiverseRoutes } from "../route-recommendation/diversity.ts";
import { findScenicRoutes } from "../route-recommendation/findScenicRoutes.ts";
import type { FindScenicRoutesLimits } from "../route-recommendation/ports.ts";
import { ScenicScoreV1 } from "../route-recommendation/scoring.ts";
import type { PlanScenicRoutes } from "./handler.ts";

export type ProductionRoutePlannerOptions = Readonly<{
  amapWebServiceKey: string;
  amapCity?: string;
  limits?: Partial<FindScenicRoutesLimits>;
}>;

export function createProductionRoutePlanner(
  options: ProductionRoutePlannerOptions,
): PlanScenicRoutes {
  const client = new AmapWebServiceClient({
    apiKey: options.amapWebServiceKey,
  });
  const placeProvider = new AmapPlaceProvider(client, {
    city: options.amapCity,
  });
  const routeProvider = new AmapRouteProvider(client);
  const sceneryProvider = new WorldCoverSceneryProvider();
  const scoringPolicy = new ScenicScoreV1();

  return (request, signal) =>
    findScenicRoutes(request, {
      placeProvider,
      routeProvider,
      sceneryProvider,
      scoringPolicy,
      candidateGenerationStrategy: generateDirectionalCandidates,
      routeSelectionStrategy: selectDiverseRoutes,
      signal,
      limits: options.limits,
    });
}
