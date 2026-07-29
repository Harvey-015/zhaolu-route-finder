import {
  distanceMeters,
  type Wgs84Point,
} from "../../route-recommendation/coordinates.ts";
import { ProviderError } from "../../route-recommendation/errors.ts";
import type {
  RoutedRoute,
  RouteSegment,
  TravelMode,
} from "../../route-recommendation/models.ts";
import type {
  ProviderCallContext,
  RouteProvider,
} from "../../route-recommendation/ports.ts";
import {
  formatGcj02Point,
  wgs84ToGcj02,
} from "./coordinates.ts";
import type { AmapWebServiceClient } from "./httpClient.ts";
import { mapAmapRouteLegResponse } from "./mappers.ts";

const ROUTE_PATHS: Readonly<Record<TravelMode, string>> = {
  running: "/v5/direction/walking",
  cycling: "/v5/direction/bicycling",
};

export type AmapRouteProviderOptions = Readonly<{
  id?: string;
  maxLegsPerRoute?: number;
}>;

function appendGeometry(
  target: Wgs84Point[],
  source: readonly Wgs84Point[],
) {
  source.forEach((point, index) => {
    const previous = target.at(-1);
    if (
      index === 0 &&
      previous &&
      distanceMeters(previous, point) < 0.5
    ) {
      return;
    }
    target.push(point);
  });
}

export class AmapRouteProvider implements RouteProvider {
  readonly id: string;
  private readonly client: AmapWebServiceClient;
  private readonly maxLegsPerRoute: number;

  constructor(
    client: AmapWebServiceClient,
    options: AmapRouteProviderOptions = {},
  ) {
    const maxLegsPerRoute = options.maxLegsPerRoute ?? 6;
    if (!Number.isInteger(maxLegsPerRoute) || maxLegsPerRoute < 1) {
      throw new RangeError("AMAP_ROUTE_LEG_LIMIT_INVALID");
    }
    this.client = client;
    this.id = options.id ?? "amap-route";
    this.maxLegsPerRoute = maxLegsPerRoute;
  }

  async getRoute(
    request: Parameters<RouteProvider["getRoute"]>[0],
    context: ProviderCallContext,
  ): Promise<RoutedRoute> {
    const points = [
      request.candidate.origin,
      ...request.candidate.waypoints,
      request.candidate.destination,
    ];
    const legCount = points.length - 1;
    if (legCount < 1 || legCount > this.maxLegsPerRoute) {
      throw new ProviderError({
        providerId: this.id,
        code: "INVALID_RESPONSE",
        message: "AMAP_ROUTE_LEG_LIMIT_EXCEEDED",
        retryable: false,
      });
    }

    const geometry: Wgs84Point[] = [];
    const segments: RouteSegment[] = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let hasCompleteDuration = true;

    for (let legIndex = 0; legIndex < legCount; legIndex += 1) {
      const origin = wgs84ToGcj02(points[legIndex]);
      const destination = wgs84ToGcj02(points[legIndex + 1]);
      const response = await this.client.getJson(
        this.id,
        ROUTE_PATHS[request.mode],
        {
          origin: formatGcj02Point(origin),
          destination: formatGcj02Point(destination),
          alternative_route: "1",
          show_fields: "cost,navi,polyline",
          isindoor: request.mode === "running" ? "0" : undefined,
          output: "JSON",
        },
        context,
      );
      const mappedLeg = mapAmapRouteLegResponse(response, this.id);
      appendGeometry(geometry, mappedLeg.geometry);
      mappedLeg.segments.forEach((segment) => {
        segments.push({
          ...segment,
          index: segments.length,
        });
      });
      totalDistance += mappedLeg.distanceMeters;
      if (mappedLeg.durationSeconds === null) {
        hasCompleteDuration = false;
      } else {
        totalDuration += mappedLeg.durationSeconds;
      }
    }

    return {
      id: `${this.id}:${request.candidate.id}`,
      candidateId: request.candidate.id,
      geometry,
      segments,
      distanceMeters: totalDistance,
      durationSeconds: hasCompleteDuration ? totalDuration : null,
      directionDegrees: request.candidate.directionDegrees,
      source: {
        providerId: this.id,
        externalId: request.candidate.id,
      },
    };
  }
}
