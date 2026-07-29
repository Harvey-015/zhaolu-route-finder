import { ProviderError } from "../../route-recommendation/errors.ts";
import type {
  ResolvedPlace,
} from "../../route-recommendation/models.ts";
import type {
  PlaceProvider,
  ProviderCallContext,
} from "../../route-recommendation/ports.ts";
import type { AmapWebServiceClient } from "./httpClient.ts";
import { mapAmapGeocodeResponse } from "./mappers.ts";

export type AmapPlaceProviderOptions = Readonly<{
  id?: string;
  city?: string;
}>;

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
    const response = await this.client.getJson(
      this.id,
      "/v3/geocode/geo",
      {
        address: query,
        city: this.city,
        output: "JSON",
      },
      context,
    );
    return mapAmapGeocodeResponse(response, {
      providerId: this.id,
      fallbackName: query,
    });
  }
}
