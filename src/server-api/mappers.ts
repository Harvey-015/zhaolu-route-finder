import {
  wgs84Point,
} from "../route-recommendation/coordinates.ts";
import { RouteRecommendationError } from "../route-recommendation/errors.ts";
import type {
  FindScenicRoutesRequest,
  FindScenicRoutesResult,
  PlaceInput,
  ResolvedPlace,
} from "../route-recommendation/models.ts";
import {
  resolveRouteDeliveryPolicy,
  type RouteDeliveryPolicyResolver,
} from "../route-delivery/policy.ts";
import {
  SERVER_API_SCHEMA_VERSION,
  type ApiPlace,
  type ApiPlaceInput,
  type PlanRoutesApiResponse,
} from "./contracts.ts";

function invalid(field: string): never {
  throw new RouteRecommendationError({
    code: "INVALID_REQUEST",
    details: { field },
  });
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find(
    (key) => !allowedKeys.has(key),
  );
  if (unexpected) {
    invalid(field === "$" ? unexpected : `${field}.${unexpected}`);
  }
}

function requiredString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) invalid(field);
  return normalized;
}

function optionalLabel(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, 200);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(field);
  }
  return value;
}

function mapPlaceInput(
  value: unknown,
  field: string,
): PlaceInput {
  if (!isRecord(value)) invalid(field);
  if (value.kind === "query") {
    assertOnlyKeys(value, ["kind", "query"], field);
    return {
      kind: "query",
      query: requiredString(value.query, `${field}.query`, 200),
    };
  }
  if (value.kind === "point") {
    assertOnlyKeys(
      value,
      ["kind", "longitude", "latitude", "crs", "label"],
      field,
    );
    if (value.crs !== "WGS84") invalid(`${field}.crs`);
    try {
      return {
        kind: "point",
        point: wgs84Point(
          finiteNumber(value.longitude, `${field}.longitude`),
          finiteNumber(value.latitude, `${field}.latitude`),
        ),
        label: optionalLabel(value.label, `${field}.label`),
      };
    } catch (error) {
      if (error instanceof RouteRecommendationError) throw error;
      invalid(field);
    }
  }
  return invalid(`${field}.kind`);
}

function mapPreferences(
  value: unknown,
): FindScenicRoutesRequest["preferences"] {
  if (!isRecord(value)) invalid("preferences");
  assertOnlyKeys(
    value,
    ["greenery", "waterfront", "lowTraffic", "comfort"],
    "preferences",
  );
  return {
    greenery: finiteNumber(
      value.greenery,
      "preferences.greenery",
    ),
    waterfront: finiteNumber(
      value.waterfront,
      "preferences.waterfront",
    ),
    lowTraffic: finiteNumber(
      value.lowTraffic,
      "preferences.lowTraffic",
    ),
    comfort: finiteNumber(
      value.comfort,
      "preferences.comfort",
    ),
  };
}

export function mapPlanRoutesApiRequest(
  value: unknown,
  fallbackRequestId: string,
): FindScenicRoutesRequest {
  if (!isRecord(value)) invalid("$");
  assertOnlyKeys(
    value,
    [
      "schemaVersion",
      "requestId",
      "start",
      "mode",
      "targetDistanceMeters",
      "preferences",
      "requiredStops",
      "maxResults",
    ],
    "$",
  );
  if (value.schemaVersion !== SERVER_API_SCHEMA_VERSION) {
    invalid("schemaVersion");
  }
  const requestId =
    value.requestId === undefined
      ? fallbackRequestId
      : requiredString(value.requestId, "requestId", 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    invalid("requestId");
  }
  if (value.mode !== "running" && value.mode !== "cycling") {
    invalid("mode");
  }
  const requiredStopsValue = value.requiredStops ?? [];
  if (!Array.isArray(requiredStopsValue)) {
    invalid("requiredStops");
  }
  if (requiredStopsValue.length > 3) {
    invalid("requiredStops");
  }
  const maxResults =
    value.maxResults === undefined
      ? undefined
      : finiteNumber(value.maxResults, "maxResults");

  return {
    requestId,
    start: mapPlaceInput(value.start, "start"),
    mode: value.mode,
    targetDistanceMeters: finiteNumber(
      value.targetDistanceMeters,
      "targetDistanceMeters",
    ),
    preferences: mapPreferences(value.preferences),
    requiredStops: requiredStopsValue.map((stop, index) =>
      mapPlaceInput(stop, `requiredStops.${index}`),
    ),
    maxResults,
  };
}

function mapPlace(place: ResolvedPlace): ApiPlace {
  return {
    id: place.id,
    name: place.name,
    point: {
      type: "Point",
      coordinates: [
        place.point.longitude,
        place.point.latitude,
      ],
    },
    source: place.source,
  };
}

export function mapFindScenicRoutesResult(
  result: FindScenicRoutesResult,
  policyResolver: RouteDeliveryPolicyResolver =
    resolveRouteDeliveryPolicy,
): PlanRoutesApiResponse {
  return {
    schemaVersion: SERVER_API_SCHEMA_VERSION,
    requestId: result.requestId,
    status: result.status,
    start: mapPlace(result.start),
    requiredStops: result.requiredStops.map(mapPlace),
    routes: result.routes.map(
      ({ route, scenicFeatures, score }) => ({
        id: route.id,
        candidateId: route.candidateId,
        geometry: {
          type: "LineString",
          coordinates: route.geometry.map(
            ({ longitude, latitude }) =>
              [longitude, latitude] as const,
          ),
        },
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        directionDegrees: route.directionDegrees,
        source: route.source,
        scenicFeatures,
        score,
        delivery: policyResolver(route.source.providerId),
      }),
    ),
    warnings: result.warnings,
    diagnostics: result.diagnostics,
  };
}

export function apiPlaceInput(
  input: PlaceInput,
): ApiPlaceInput {
  if (input.kind === "query") return input;
  return {
    kind: "point",
    longitude: input.point.longitude,
    latitude: input.point.latitude,
    crs: "WGS84",
    label: input.label,
  };
}
