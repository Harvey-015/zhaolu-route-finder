import { ProviderError } from "../../route-recommendation/errors.ts";
import type {
  ResolvedPlace,
} from "../../route-recommendation/models.ts";
import type {
  PlaceProvider,
  ProviderCallContext,
} from "../../route-recommendation/ports.ts";
import type { AmapWebServiceClient } from "./httpClient.ts";
import { formatGcj02Point, wgs84ToGcj02 } from "./coordinates.ts";
import {
  mapAmapGeocodeResponse,
  mapAmapPlaceTextResponse,
} from "./mappers.ts";

export type AmapPlaceProviderOptions = Readonly<{
  id?: string;
  city?: string;
}>;

function placeQueryVariants(query: string): readonly string[] {
  const variants = [query];
  const governmentMatch = query.match(/^(.*[省市区县镇])政府$/u);
  if (governmentMatch) {
    variants.push(`${governmentMatch[1]}人民政府`);
  }
  return variants;
}

export class AmapPlaceProvider implements PlaceProvider {
  readonly id: string;
  private readonly client: AmapWebServiceClient;
  private readonly city?: string;

  constructor(
    client: AmapWebServiceClient,
    options: AmapPlaceProviderOptions = {},
  ) {
    this.client = client;
    this.id = options.id ?? "amap-place";
    this.city = options.city?.trim() || undefined;
  }

  async resolve(
    request: Parameters<PlaceProvider["resolve"]>[0],
    context: ProviderCallContext,
  ): Promise<ResolvedPlace> {
    if (context.signal?.aborted) {
      throw new ProviderError({
        providerId: this.id,
        code: "ABORTED",
        message: "AMAP_REQUEST_ABORTED",
      });
    }
    if (request.input.kind === "point") {
      const coordinateLabel = [
        request.input.point.longitude.toFixed(6),
        request.input.point.latitude.toFixed(6),
      ].join(",");
      return {
        id: `${this.id}:input:${coordinateLabel}`,
        name: request.input.label?.trim() || coordinateLabel,
        point: request.input.point,
        source: { providerId: this.id },
      };
    }

    const query = request.input.query.trim();
    if (!query) {
      throw new ProviderError({
        providerId: this.id,
        code: "NOT_FOUND",
        message: "AMAP_PLACE_NOT_FOUND",
        retryable: false,
      });
    }
    const near = request.near
      ? formatGcj02Point(wgs84ToGcj02(request.near))
      : undefined;
    for (const placeQuery of placeQueryVariants(query)) {
      try {
        const placeResponse = await this.client.getJson(
          this.id,
          "/v3/place/text",
          {
            keywords: placeQuery,
            location: near,
            sortrule: near ? "distance" : undefined,
            city: this.city,
            citylimit: "false",
            offset: "10",
            page: "1",
            extensions: "base",
            output: "JSON",
          },
          context,
        );
        const place = mapAmapPlaceTextResponse(placeResponse, {
          providerId: this.id,
        });
        if (place) return place;
      } catch (error) {
        if (!(error instanceof ProviderError) || !error.retryable) {
          throw error;
        }
      }
    }

    const geocodeResponse = await this.client.getJson(
      this.id,
      "/v3/geocode/geo",
      {
        address: query,
        city: this.city,
        output: "JSON",
      },
      context,
    );
    return mapAmapGeocodeResponse(geocodeResponse, {
      providerId: this.id,
      fallbackName: query,
    });
  }
}
