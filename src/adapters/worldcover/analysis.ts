import {
  distanceMeters,
  wgs84Point,
  type Wgs84Point,
} from "../../route-recommendation/coordinates.ts";
import type {
  FeatureMetric,
  RoutedRoute,
  ScenicFeatures,
} from "../../route-recommendation/models.ts";
import {
  validateWorldCoverGrid,
  type WorldCoverBounds,
  type WorldCoverClassCode,
  type WorldCoverGrid,
} from "./rasterSource.ts";

const METERS_PER_LATITUDE_DEGREE = 111_320;
const GREEN_CLASSES = new Set<WorldCoverClassCode>([
  10, 20, 30, 90, 95,
]);
const WATER_CLASSES = new Set<WorldCoverClassCode>([
  80, 90, 95,
]);
const BUILT_CLASS: WorldCoverClassCode = 50;

export type WorldCoverAnchorCandidate = Readonly<{
  point: Wgs84Point;
  classCode: WorldCoverClassCode;
  score: number;
}>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function longitudeMetersPerDegree(latitude: number): number {
  return Math.max(
    1_000,
    METERS_PER_LATITUDE_DEGREE *
      Math.cos((latitude * Math.PI) / 180),
  );
}

export function boundsAroundPoint(
  point: Wgs84Point,
  radiusMeters: number,
): WorldCoverBounds {
  const latitudeDelta = radiusMeters / METERS_PER_LATITUDE_DEGREE;
  const longitudeDelta =
    radiusMeters / longitudeMetersPerDegree(point.latitude);
  return {
    minLongitude: clamp(point.longitude - longitudeDelta, -180, 180),
    minLatitude: clamp(point.latitude - latitudeDelta, -90, 90),
    maxLongitude: clamp(point.longitude + longitudeDelta, -180, 180),
    maxLatitude: clamp(point.latitude + latitudeDelta, -90, 90),
  };
}

export function boundsAroundRoutes(
  routes: readonly RoutedRoute[],
  bufferMeters: number,
): WorldCoverBounds | null {
  const points = routes.flatMap((route) => route.geometry);
  if (points.length === 0) return null;
  const minLongitude = Math.min(
    ...points.map(({ longitude }) => longitude),
  );
  const maxLongitude = Math.max(
    ...points.map(({ longitude }) => longitude),
  );
  const minLatitude = Math.min(
    ...points.map(({ latitude }) => latitude),
  );
  const maxLatitude = Math.max(
    ...points.map(({ latitude }) => latitude),
  );
  const middleLatitude = (minLatitude + maxLatitude) / 2;
  const latitudeDelta = bufferMeters / METERS_PER_LATITUDE_DEGREE;
  const longitudeDelta =
    bufferMeters / longitudeMetersPerDegree(middleLatitude);
  return {
    minLongitude: clamp(minLongitude - longitudeDelta, -180, 180),
    minLatitude: clamp(minLatitude - latitudeDelta, -90, 90),
    maxLongitude: clamp(maxLongitude + longitudeDelta, -180, 180),
    maxLatitude: clamp(maxLatitude + latitudeDelta, -90, 90),
  };
}

export function gridDimensions(
  bounds: WorldCoverBounds,
  maxDimension: number,
  minimumCellSizeMeters: number,
): Readonly<{ width: number; height: number }> {
  const middleLatitude =
    (bounds.minLatitude + bounds.maxLatitude) / 2;
  const widthMeters =
    (bounds.maxLongitude - bounds.minLongitude) *
    longitudeMetersPerDegree(middleLatitude);
  const heightMeters =
    (bounds.maxLatitude - bounds.minLatitude) *
    METERS_PER_LATITUDE_DEGREE;
  return {
    width: clamp(
      Math.ceil(widthMeters / minimumCellSizeMeters),
      1,
      maxDimension,
    ),
    height: clamp(
      Math.ceil(heightMeters / minimumCellSizeMeters),
      1,
      maxDimension,
    ),
  };
}

function gridIndex(
  grid: WorldCoverGrid,
  point: Wgs84Point,
): number | null {
  if (
    point.longitude < grid.bounds.minLongitude ||
    point.longitude > grid.bounds.maxLongitude ||
    point.latitude < grid.bounds.minLatitude ||
    point.latitude > grid.bounds.maxLatitude
  ) {
    return null;
  }
  const x = clamp(
    Math.floor(
      ((point.longitude - grid.bounds.minLongitude) /
        (grid.bounds.maxLongitude - grid.bounds.minLongitude)) *
        grid.width,
    ),
    0,
    grid.width - 1,
  );
  const y = clamp(
    Math.floor(
      ((grid.bounds.maxLatitude - point.latitude) /
        (grid.bounds.maxLatitude - grid.bounds.minLatitude)) *
        grid.height,
    ),
    0,
    grid.height - 1,
  );
  return y * grid.width + x;
}

function gridPoint(grid: WorldCoverGrid, index: number): Wgs84Point {
  const x = index % grid.width;
  const y = Math.floor(index / grid.width);
  return wgs84Point(
    grid.bounds.minLongitude +
      ((x + 0.5) / grid.width) *
        (grid.bounds.maxLongitude - grid.bounds.minLongitude),
    grid.bounds.maxLatitude -
      ((y + 0.5) / grid.height) *
        (grid.bounds.maxLatitude - grid.bounds.minLatitude),
  );
}

function maskIntegral(
  grid: WorldCoverGrid,
  matches: (value: WorldCoverClassCode) => boolean,
): Uint32Array {
  const stride = grid.width + 1;
  const integral = new Uint32Array(
    (grid.width + 1) * (grid.height + 1),
  );
  for (let y = 0; y < grid.height; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < grid.width; x += 1) {
      const value = grid.values[y * grid.width + x];
      rowTotal += matches(value as WorldCoverClassCode) ? 1 : 0;
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowTotal;
    }
  }
  return integral;
}

function maskHasValueNear(
  integral: Uint32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
): boolean {
  const stride = width + 1;
  const left = Math.max(0, x - radiusX);
  const right = Math.min(width - 1, x + radiusX);
  const top = Math.max(0, y - radiusY);
  const bottom = Math.min(height - 1, y + radiusY);
  const count =
    integral[(bottom + 1) * stride + right + 1] -
    integral[top * stride + right + 1] -
    integral[(bottom + 1) * stride + left] +
    integral[top * stride + left];
  return count > 0;
}

function neighborhoodPixelRadius(
  grid: WorldCoverGrid,
  radiusMeters: number,
): Readonly<{ x: number; y: number }> {
  const middleLatitude =
    (grid.bounds.minLatitude + grid.bounds.maxLatitude) / 2;
  const cellWidthMeters =
    ((grid.bounds.maxLongitude - grid.bounds.minLongitude) *
      longitudeMetersPerDegree(middleLatitude)) /
    grid.width;
  const cellHeightMeters =
    ((grid.bounds.maxLatitude - grid.bounds.minLatitude) *
      METERS_PER_LATITUDE_DEGREE) /
    grid.height;
  return {
    x: Math.max(1, Math.ceil(radiusMeters / cellWidthMeters)),
    y: Math.max(1, Math.ceil(radiusMeters / cellHeightMeters)),
  };
}

export function rankWorldCoverAnchors(
  grid: WorldCoverGrid,
  origin: Wgs84Point,
  radiusMeters: number,
  limit: number,
  preferences: Readonly<{
    greenery: number;
    waterfront: number;
    lowTraffic: number;
  }>,
  providerId: string,
): readonly WorldCoverAnchorCandidate[] {
  validateWorldCoverGrid(grid, providerId);
  if (limit < 1) return [];
  const waterIntegral = maskIntegral(
    grid,
    (value) => WATER_CLASSES.has(value),
  );
  const waterRadius = neighborhoodPixelRadius(grid, 250);
  const candidates: WorldCoverAnchorCandidate[] = [];

  for (let index = 0; index < grid.values.length; index += 1) {
    const classCode = grid.values[index] as WorldCoverClassCode;
    if (classCode === 0 || WATER_CLASSES.has(classCode)) continue;
    const point = gridPoint(grid, index);
    if (distanceMeters(origin, point) > radiusMeters) continue;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    const green = GREEN_CLASSES.has(classCode) ? 1 : 0;
    const waterfront = maskHasValueNear(
      waterIntegral,
      grid.width,
      grid.height,
      x,
      y,
      waterRadius.x,
      waterRadius.y,
    )
      ? 1
      : 0;
    if (green === 0 && waterfront === 0) continue;
    const built = classCode === BUILT_CLASS ? 1 : 0;
    const score =
      green * preferences.greenery +
      waterfront * preferences.waterfront +
      (1 - built) * preferences.lowTraffic * 0.15;
    candidates.push({ point, classCode, score });
  }

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.point.latitude - right.point.latitude ||
      left.point.longitude - right.point.longitude,
  );
  const minimumSeparationMeters = Math.max(
    200,
    radiusMeters / Math.max(3, Math.sqrt(limit) * 2.2),
  );
  const selected: WorldCoverAnchorCandidate[] = [];
  for (const candidate of candidates) {
    if (
      selected.every(
        ({ point }) =>
          distanceMeters(point, candidate.point) >=
          minimumSeparationMeters,
      )
    ) {
      selected.push(candidate);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

export function sampleRouteGeometry(
  geometry: readonly Wgs84Point[],
  maximumGapMeters = 75,
  maximumSamples = 500,
): readonly Wgs84Point[] {
  if (geometry.length === 0) return [];
  if (geometry.length === 1) return [geometry[0]];
  const segments = geometry.slice(1).map((point, index) => ({
    start: geometry[index],
    end: point,
    length: distanceMeters(geometry[index], point),
  }));
  const totalLength = segments.reduce(
    (total, segment) => total + segment.length,
    0,
  );
  if (totalLength === 0) return [geometry[0]];
  const sampleCount = Math.min(
    maximumSamples,
    Math.max(2, Math.ceil(totalLength / maximumGapMeters) + 1),
  );
  const samples: Wgs84Point[] = [];
  let segmentIndex = 0;
  let distanceBeforeSegment = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const targetDistance =
      (totalLength * index) / (sampleCount - 1);
    while (
      segmentIndex < segments.length - 1 &&
      distanceBeforeSegment + segments[segmentIndex].length <
        targetDistance
    ) {
      distanceBeforeSegment += segments[segmentIndex].length;
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex];
    const ratio =
      segment.length === 0
        ? 0
        : clamp(
            (targetDistance - distanceBeforeSegment) /
              segment.length,
            0,
            1,
          );
    const longitudeDelta =
      ((segment.end.longitude -
        segment.start.longitude +
        540) %
        360) -
      180;
    const longitude =
      ((segment.start.longitude + longitudeDelta * ratio + 540) %
        360) -
      180;
    samples.push(
      wgs84Point(
        longitude,
        segment.start.latitude +
          (segment.end.latitude - segment.start.latitude) * ratio,
      ),
    );
  }
  return samples;
}

function featureMetric(
  value: number,
  confidence: number,
  providerId: string,
  sourceVersion: string,
): FeatureMetric {
  return {
    value,
    confidence,
    source: { providerId },
    sourceVersion,
  };
}

export function analyzeRouteWithWorldCover(
  route: RoutedRoute,
  grid: WorldCoverGrid,
  providerId: string,
  sourceVersion: string,
): ScenicFeatures {
  validateWorldCoverGrid(grid, providerId);
  const samples = sampleRouteGeometry(route.geometry);
  if (samples.length === 0) {
    return {
      availability: "unavailable",
      greenCoverage: null,
      waterfrontProximity: null,
      builtUpExposure: null,
      roadComfort: null,
    };
  }

  const waterIntegral = maskIntegral(
    grid,
    (value) => WATER_CLASSES.has(value),
  );
  const waterRadius = neighborhoodPixelRadius(grid, 180);
  let covered = 0;
  let green = 0;
  let waterfront = 0;
  let built = 0;
  for (const point of samples) {
    const index = gridIndex(grid, point);
    if (index === null) continue;
    const classCode = grid.values[index] as WorldCoverClassCode;
    if (classCode === 0) continue;
    covered += 1;
    if (GREEN_CLASSES.has(classCode)) green += 1;
    if (classCode === BUILT_CLASS) built += 1;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (
      maskHasValueNear(
        waterIntegral,
        grid.width,
        grid.height,
        x,
        y,
        waterRadius.x,
        waterRadius.y,
      )
    ) {
      waterfront += 1;
    }
  }

  const confidence = covered / samples.length;
  if (confidence < 0.6) {
    return {
      availability: "unavailable",
      greenCoverage: null,
      waterfrontProximity: null,
      builtUpExposure: null,
      roadComfort: null,
    };
  }

  return {
    availability: "partial",
    greenCoverage: featureMetric(
      green / covered,
      confidence,
      providerId,
      sourceVersion,
    ),
    waterfrontProximity: featureMetric(
      waterfront / covered,
      confidence,
      providerId,
      sourceVersion,
    ),
    builtUpExposure: featureMetric(
      built / covered,
      confidence,
      providerId,
      sourceVersion,
    ),
    roadComfort: null,
  };
}
