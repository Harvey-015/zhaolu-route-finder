import {
  distanceMeters,
  gcj02Point,
  type Wgs84Point,
} from "../../route-recommendation/coordinates.ts";
import type {
  ResolvedPlace,
  RouteSegment,
} from "../../route-recommendation/models.ts";
import type {
  AmapApiEnvelopeDto,
  AmapGeocodeDto,
  AmapGeocodeResponseDto,
  AmapRouteCostDto,
  AmapRoutePathDto,
  AmapRouteResponseDto,
  AmapRouteStepDto,
} from "./dto.ts";
import { amapApiFailure, invalidAmapResponse } from "./errors.ts";
import { gcj02ToWgs84 } from "./coordinates.ts";

type UnknownRecord = Record<string, unknown>;

export type MappedAmapRouteLeg = Readonly<{
  geometry: readonly Wgs84Point[];
  segments: readonly RouteSegment[];
  distanceMeters: number;
  durationSeconds: number | null;
}>;

function asRecord(value: unknown, providerId: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidAmapResponse(providerId);
  }
  return value as UnknownRecord;
}

function requiredString(value: unknown, providerId: string): string {
  if (typeof value !== "string") {
    throw invalidAmapResponse(providerId);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredArray(value: unknown, providerId: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidAmapResponse(providerId);
  return value;
}

function optionalCost(
  value: unknown,
  providerId: string,
): AmapRouteCostDto | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, providerId);
  const duration = optionalString(record.duration);
  return duration === undefined ? {} : { duration };
}

function parseEnvelope(
  value: unknown,
  providerId: string,
): AmapApiEnvelopeDto & UnknownRecord {
  const record = asRecord(value, providerId);
  const envelope = {
    status: requiredString(record.status, providerId),
    info: requiredString(record.info, providerId),
    infocode: requiredString(record.infocode, providerId),
  };
  if (envelope.status !== "1" || envelope.infocode !== "10000") {
    throw amapApiFailure(providerId, envelope.infocode);
  }
  return { ...record, ...envelope };
}

function parseGeocode(
  value: unknown,
  providerId: string,
): AmapGeocodeDto {
  const record = asRecord(value, providerId);
  return {
    formatted_address: optionalString(record.formatted_address),
    country: optionalString(record.country),
    province: optionalString(record.province),
    city: optionalString(record.city),
    citycode: optionalString(record.citycode),
    district: optionalString(record.district),
    street: optionalString(record.street),
    number: optionalString(record.number),
    adcode: optionalString(record.adcode),
    location: requiredString(record.location, providerId),
    level: optionalString(record.level),
  };
}

export function parseAmapGeocodeResponse(
  value: unknown,
  providerId: string,
): AmapGeocodeResponseDto {
  const envelope = parseEnvelope(value, providerId);
  return {
    status: envelope.status,
    info: envelope.info,
    infocode: envelope.infocode,
    count: requiredString(envelope.count, providerId),
    geocodes: requiredArray(envelope.geocodes, providerId).map(
      (geocode) => parseGeocode(geocode, providerId),
    ),
  };
}

function parseRouteStep(
  value: unknown,
  providerId: string,
): AmapRouteStepDto {
  const record = asRecord(value, providerId);
  return {
    instruction: optionalString(record.instruction),
    orientation: optionalString(record.orientation),
    road_name: optionalString(record.road_name),
    step_distance: optionalString(record.step_distance),
    distance: optionalString(record.distance),
    cost: optionalCost(record.cost, providerId),
    duration: optionalString(record.duration),
    polyline: requiredString(record.polyline, providerId),
  };
}

function parseRoutePath(
  value: unknown,
  providerId: string,
): AmapRoutePathDto {
  const record = asRecord(value, providerId);
  return {
    distance: requiredString(record.distance, providerId),
    cost: optionalCost(record.cost, providerId),
    duration: optionalString(record.duration),
    steps: requiredArray(record.steps, providerId).map((step) =>
      parseRouteStep(step, providerId),
    ),
  };
}

export function parseAmapRouteResponse(
  value: unknown,
  providerId: string,
): AmapRouteResponseDto {
  const envelope = parseEnvelope(value, providerId);
  const route = asRecord(envelope.route, providerId);
  return {
    status: envelope.status,
    info: envelope.info,
    infocode: envelope.infocode,
    count: requiredString(envelope.count, providerId),
    route: {
      origin: requiredString(route.origin, providerId),
      destination: requiredString(route.destination, providerId),
      paths: requiredArray(route.paths, providerId).map((path) =>
        parseRoutePath(path, providerId),
      ),
    },
  };
}

function numericValue(
  value: string | undefined,
  providerId: string,
  options: Readonly<{ positive?: boolean }> = {},
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    (options.positive && parsed <= 0)
  ) {
    throw invalidAmapResponse(providerId);
  }
  return parsed;
}

function parsePolyline(
  polyline: string,
  providerId: string,
): Wgs84Point[] {
  const points = polyline
    .split(";")
    .filter(Boolean)
    .map((coordinate) => {
      const parts = coordinate.split(",");
      if (parts.length !== 2) throw invalidAmapResponse(providerId);
      const longitude = Number(parts[0]);
      const latitude = Number(parts[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw invalidAmapResponse(providerId);
      }
      try {
        return gcj02ToWgs84(gcj02Point(longitude, latitude));
      } catch {
        throw invalidAmapResponse(providerId);
      }
    });

  if (points.length < 2) throw invalidAmapResponse(providerId);
  return points;
}

function measuredGeometryDistance(geometry: readonly Wgs84Point[]) {
  return geometry
    .slice(1)
    .reduce(
      (total, point, index) =>
        total + distanceMeters(geometry[index], point),
      0,
    );
}

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

export function mapAmapGeocodeResponse(
  value: unknown,
  input: Readonly<{
    providerId: string;
    fallbackName: string;
  }>,
): ResolvedPlace {
  const response = parseAmapGeocodeResponse(value, input.providerId);
  const geocode = response.geocodes[0];
  if (!geocode) {
    throw amapApiFailure(input.providerId, "20801");
  }

  const parts = geocode.location.split(",");
  if (parts.length !== 2) throw invalidAmapResponse(input.providerId);
  const longitude = Number(parts[0]);
  const latitude = Number(parts[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw invalidAmapResponse(input.providerId);
  }

  let point: Wgs84Point;
  try {
    point = gcj02ToWgs84(gcj02Point(longitude, latitude));
  } catch {
    throw invalidAmapResponse(input.providerId);
  }
  const externalId = [geocode.adcode, geocode.location]
    .filter(Boolean)
    .join(":");

  return {
    id: `${input.providerId}:${externalId || geocode.location}`,
    name: geocode.formatted_address ?? input.fallbackName,
    point,
    source: {
      providerId: input.providerId,
      externalId: externalId || geocode.location,
    },
  };
}

export function mapAmapRouteLegResponse(
  value: unknown,
  providerId: string,
): MappedAmapRouteLeg {
  const response = parseAmapRouteResponse(value, providerId);
  const path = response.route.paths[0];
  if (!path) throw amapApiFailure(providerId, "20802");

  const geometry: Wgs84Point[] = [];
  const segments = path.steps.map((step, index): RouteSegment => {
    const stepGeometry = parsePolyline(step.polyline, providerId);
    appendGeometry(geometry, stepGeometry);
    const distance =
      numericValue(
        step.step_distance ?? step.distance,
        providerId,
      ) ?? measuredGeometryDistance(stepGeometry);
    const duration =
      numericValue(
        step.cost?.duration ?? step.duration,
        providerId,
      ) ?? null;
    return {
      index,
      geometry: stepGeometry,
      distanceMeters: distance,
      durationSeconds: duration,
    };
  });
  if (segments.length === 0 || geometry.length < 2) {
    throw invalidAmapResponse(providerId);
  }

  const pathDistance = numericValue(path.distance, providerId, {
    positive: true,
  });
  if (pathDistance === undefined) throw invalidAmapResponse(providerId);
  const pathDuration =
    numericValue(path.cost?.duration ?? path.duration, providerId) ??
    (segments.every(({ durationSeconds }) => durationSeconds !== null)
      ? segments.reduce(
          (total, segment) => total + (segment.durationSeconds ?? 0),
          0,
        )
      : null);

  return {
    geometry,
    segments,
    distanceMeters: pathDistance,
    durationSeconds: pathDuration,
  };
}
