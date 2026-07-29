import type { Wgs84Point } from "../../route-recommendation/coordinates.ts";
import type {
  RoutePreferences,
  RoutedRoute,
  ScenicAnchor,
  ScenicFeatures,
} from "../../route-recommendation/models.ts";
import type {
  ProviderCallContext,
  SceneryProvider,
} from "../../route-recommendation/ports.ts";
import {
  analyzeRouteWithWorldCover,
  boundsAroundPoint,
  boundsAroundRoutes,
  gridDimensions,
  rankWorldCoverAnchors,
} from "./analysis.ts";
import { CogWorldCoverRasterSource } from "./cogSource.ts";
import type { WorldCoverRasterSource } from "./rasterSource.ts";

const SOURCE_VERSION = "2021-v200";
const MAX_GRID_DIMENSION = 320;
const MINIMUM_CELL_SIZE_METERS = 24;
const ROUTE_BUFFER_METERS = 180;

export type WorldCoverSceneryProviderOptions = Readonly<{
  rasterSource?: WorldCoverRasterSource;
  sourceVersion?: string;
  maxGridDimension?: number;
  minimumCellSizeMeters?: number;
}>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class WorldCoverSceneryProvider
  implements SceneryProvider
{
  readonly id = "worldcover-scenery";
  private readonly rasterSource: WorldCoverRasterSource;
  private readonly sourceVersion: string;
  private readonly maxGridDimension: number;
  private readonly minimumCellSizeMeters: number;

  constructor(options: WorldCoverSceneryProviderOptions = {}) {
    this.sourceVersion = options.sourceVersion ?? SOURCE_VERSION;
    if (!this.sourceVersion.trim()) {
      throw new TypeError("WORLDCOVER_SOURCE_VERSION_REQUIRED");
    }
    this.maxGridDimension =
      options.maxGridDimension ?? MAX_GRID_DIMENSION;
    this.minimumCellSizeMeters =
      options.minimumCellSizeMeters ?? MINIMUM_CELL_SIZE_METERS;
    if (
      !Number.isInteger(this.maxGridDimension) ||
      this.maxGridDimension < 1
    ) {
      throw new RangeError(
        "WORLDCOVER_MAX_GRID_DIMENSION_INVALID",
      );
    }
    if (
      !Number.isFinite(this.minimumCellSizeMeters) ||
      this.minimumCellSizeMeters <= 0
    ) {
      throw new RangeError(
        "WORLDCOVER_CELL_SIZE_INVALID",
      );
    }
    this.rasterSource =
      options.rasterSource ??
      new CogWorldCoverRasterSource({
        providerId: this.id,
        maxGridDimension: this.maxGridDimension,
      });
  }

  async findAnchors(
    request: Readonly<{
      origin: Wgs84Point;
      targetDistanceMeters: number;
      preferences: RoutePreferences;
      limit: number;
    }>,
    context: ProviderCallContext,
  ): Promise<readonly ScenicAnchor[]> {
    if (!Number.isInteger(request.limit) || request.limit < 0) {
      throw new RangeError("WORLDCOVER_ANCHOR_LIMIT_INVALID");
    }
    if (request.limit === 0) return [];
    const radiusMeters = clamp(
      request.targetDistanceMeters * 0.48,
      2_500,
      12_000,
    );
    const bounds = boundsAroundPoint(request.origin, radiusMeters);
    const dimensions = gridDimensions(
      bounds,
      this.maxGridDimension,
      this.minimumCellSizeMeters,
    );
    const grid = await this.rasterSource.readGrid(
      {
        bounds,
        ...dimensions,
      },
      context,
    );
    const candidates = rankWorldCoverAnchors(
      grid,
      request.origin,
      radiusMeters,
      request.limit,
      request.preferences,
      this.id,
    );
    return candidates.map(({ point, classCode }, index) => ({
      id: `worldcover:${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`,
      point,
      label: `WorldCover scenic anchor ${index + 1}`,
      source: {
        providerId: this.id,
        externalId: `class-${classCode}`,
      },
    }));
  }

  async analyzeRoutes(
    request: Readonly<{
      routes: readonly RoutedRoute[];
      preferences: RoutePreferences;
    }>,
    context: ProviderCallContext,
  ): Promise<ReadonlyMap<string, ScenicFeatures>> {
    if (request.routes.length === 0) return new Map();
    const bounds = boundsAroundRoutes(
      request.routes,
      ROUTE_BUFFER_METERS,
    );
    if (bounds === null) {
      return new Map(
        request.routes.map((route) => [
          route.id,
          {
            availability: "unavailable" as const,
            greenCoverage: null,
            waterfrontProximity: null,
            builtUpExposure: null,
            roadComfort: null,
          },
        ]),
      );
    }
    const dimensions = gridDimensions(
      bounds,
      this.maxGridDimension,
      this.minimumCellSizeMeters,
    );
    const grid = await this.rasterSource.readGrid(
      {
        bounds,
        ...dimensions,
      },
      context,
    );
    return new Map(
      request.routes.map((route) => [
        route.id,
        analyzeRouteWithWorldCover(
          route,
          grid,
          this.id,
          this.sourceVersion,
        ),
      ]),
    );
  }
}
