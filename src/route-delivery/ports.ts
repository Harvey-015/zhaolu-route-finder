import type { TravelMode } from "../route-recommendation/models.ts";
import type { ApiRecommendedRoute } from "../server-api/contracts.ts";

export type RouteExport = Readonly<{
  contentType: string;
  extension: string;
  body: string | Uint8Array<ArrayBuffer>;
}>;

export interface RouteExporter {
  readonly format: string;
  readonly label: string;

  exportRoute(route: ApiRecommendedRoute): RouteExport;
}

export type NavigationLinkContext = Readonly<{
  mode: TravelMode;
}>;

export interface NavigationLinkProvider {
  readonly target: string;
  readonly label: string;

  createLink(
    route: ApiRecommendedRoute,
    context: NavigationLinkContext,
  ): string;
}

export type RouteDeliveryCapabilities = Readonly<{
  exportFormats: readonly string[];
  navigationTargets: readonly string[];
}>;
