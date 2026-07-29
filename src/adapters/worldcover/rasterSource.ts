import type { ProviderCallContext } from "../../route-recommendation/ports.ts";
import { worldCoverProviderError } from "./errors.ts";

export const WORLD_COVER_CLASS_CODES = Object.freeze([
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100,
] as const);

const WORLD_COVER_CLASS_CODE_SET = new Set<number>(
  WORLD_COVER_CLASS_CODES,
);

export type WorldCoverClassCode =
  (typeof WORLD_COVER_CLASS_CODES)[number];

export type WorldCoverBounds = Readonly<{
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
}>;

export type WorldCoverGridRequest = Readonly<{
  bounds: WorldCoverBounds;
  width: number;
  height: number;
}>;

export type WorldCoverGrid = Readonly<{
  bounds: WorldCoverBounds;
  width: number;
  height: number;
  values: Uint8Array;
}>;

export interface WorldCoverRasterSource {
  readGrid(
    request: WorldCoverGridRequest,
    context: ProviderCallContext,
  ): Promise<WorldCoverGrid>;
}

export function isWorldCoverClassCode(
  value: number,
): value is WorldCoverClassCode {
  return WORLD_COVER_CLASS_CODE_SET.has(value);
}

export function validateWorldCoverBounds(
  bounds: WorldCoverBounds,
): void {
  if (
    !Number.isFinite(bounds.minLongitude) ||
    !Number.isFinite(bounds.minLatitude) ||
    !Number.isFinite(bounds.maxLongitude) ||
    !Number.isFinite(bounds.maxLatitude) ||
    bounds.minLongitude < -180 ||
    bounds.maxLongitude > 180 ||
    bounds.minLatitude < -90 ||
    bounds.maxLatitude > 90 ||
    bounds.minLongitude >= bounds.maxLongitude ||
    bounds.minLatitude >= bounds.maxLatitude
  ) {
    throw new RangeError("WORLDCOVER_BOUNDS_INVALID");
  }
}

export function validateWorldCoverGrid(
  grid: WorldCoverGrid,
  providerId: string,
): void {
  try {
    validateWorldCoverBounds(grid.bounds);
  } catch (error) {
    throw worldCoverProviderError(
      providerId,
      "INVALID_RESPONSE",
      error,
    );
  }
  if (
    !Number.isInteger(grid.width) ||
    !Number.isInteger(grid.height) ||
    grid.width < 1 ||
    grid.height < 1 ||
    grid.values.length !== grid.width * grid.height
  ) {
    throw worldCoverProviderError(
      providerId,
      "INVALID_RESPONSE",
    );
  }
  for (const value of grid.values) {
    if (!isWorldCoverClassCode(value)) {
      throw worldCoverProviderError(
        providerId,
        "INVALID_RESPONSE",
      );
    }
  }
}
