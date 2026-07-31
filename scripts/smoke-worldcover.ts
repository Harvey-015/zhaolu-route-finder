import { pathToFileURL } from "node:url";
import { CogWorldCoverRasterSource } from "../src/adapters/worldcover/cogSource.ts";
import type {
  WorldCoverGrid,
  WorldCoverGridRequest,
  WorldCoverRasterSource,
} from "../src/adapters/worldcover/rasterSource.ts";
import { WorldCoverSceneryProvider } from "../src/adapters/worldcover/sceneryProvider.ts";
import { wgs84Point } from "../src/route-recommendation/coordinates.ts";
import { ProviderError } from "../src/route-recommendation/errors.ts";
import type {
  FeatureMetric,
  RoutedRoute,
} from "../src/route-recommendation/models.ts";
import type { ProviderCallContext } from "../src/route-recommendation/ports.ts";

const MAX_RASTER_READS = 1;

type SmokeMetricSummary = Readonly<{
  value: number;
  confidence: number;
  sourceVersion: string;
}>;

export type WorldCoverSmokeResult =
  | Readonly<{
      status: "skipped";
      code: "WORLDCOVER_SMOKE_DISABLED";
      rasterReadCount: 0;
    }>
  | Readonly<{
      status: "passed";
      rasterReadCount: 1;
      availability: "partial";
      greenCoverage: SmokeMetricSummary;
      waterfrontProximity: SmokeMetricSummary;
      builtUpExposure: SmokeMetricSummary;
      roadComfortMissing: true;
    }>
  | Readonly<{
      status: "failed";
      code:
        | "ABORTED"
        | "INVALID_RESPONSE"
        | "NOT_FOUND"
        | "QUOTA_EXCEEDED"
        | "TIMEOUT"
        | "UNAVAILABLE"
        | "WORLDCOVER_SMOKE_READ_LIMIT_EXCEEDED"
        | "WORLDCOVER_SMOKE_VALIDATION_FAILED"
        | "WORLDCOVER_SMOKE_UNEXPECTED_ERROR";
      rasterReadCount: number;
    }>;

export type WorldCoverSmokeOptions = Readonly<{
  enabled: boolean;
  rasterSource?: WorldCoverRasterSource;
}>;

class CappedRasterSource implements WorldCoverRasterSource {
  readCount = 0;
  private readonly delegate: WorldCoverRasterSource;

  constructor(delegate: WorldCoverRasterSource) {
    this.delegate = delegate;
  }

  async readGrid(
    request: WorldCoverGridRequest,
    context: ProviderCallContext,
  ): Promise<WorldCoverGrid> {
    if (this.readCount >= MAX_RASTER_READS) {
      throw new Error("WORLDCOVER_SMOKE_READ_LIMIT_EXCEEDED");
    }
    this.readCount += 1;
    return this.delegate.readGrid(request, context);
  }
}

function smokeRoute(): RoutedRoute {
  const geometry = [
    wgs84Point(120.145, 30.26),
    wgs84Point(120.147, 30.262),
  ];
  return {
    id: "worldcover-smoke-route",
    candidateId: "worldcover-smoke-candidate",
    geometry,
    segments: [
      {
        index: 0,
        geometry,
        distanceMeters: 300,
        durationSeconds: 120,
      },
    ],
    distanceMeters: 300,
    durationSeconds: 120,
    directionDegrees: 45,
    source: { providerId: "worldcover-smoke" },
  };
}

function summarizeMetric(
  metric: FeatureMetric | null,
): SmokeMetricSummary | null {
  if (
    metric === null ||
    !Number.isFinite(metric.value) ||
    metric.value < 0 ||
    metric.value > 1 ||
    !Number.isFinite(metric.confidence) ||
    metric.confidence <= 0 ||
    metric.confidence > 1 ||
    metric.source.providerId !== "worldcover-scenery" ||
    metric.sourceVersion !== "2021-v200"
  ) {
    return null;
  }
  return {
    value: Number(metric.value.toFixed(4)),
    confidence: Number(metric.confidence.toFixed(4)),
    sourceVersion: metric.sourceVersion,
  };
}

export async function runWorldCoverSmoke(
  options: WorldCoverSmokeOptions,
): Promise<WorldCoverSmokeResult> {
  if (!options.enabled) {
    return {
      status: "skipped",
      code: "WORLDCOVER_SMOKE_DISABLED",
      rasterReadCount: 0,
    };
  }

  const cappedSource = new CappedRasterSource(
    options.rasterSource ??
      new CogWorldCoverRasterSource({
        timeoutMs: 20_000,
        maxTiles: 1,
        maxGridDimension: 64,
      }),
  );
  const provider = new WorldCoverSceneryProvider({
    rasterSource: cappedSource,
    maxGridDimension: 64,
  });

  try {
    const featuresByRoute = await provider.analyzeRoutes(
      {
        routes: [smokeRoute()],
        preferences: {
          greenery: 1,
          waterfront: 1,
          lowTraffic: 1,
          comfort: 1,
        },
      },
      { requestId: "worldcover-controlled-smoke" },
    );
    const features = featuresByRoute.get("worldcover-smoke-route");
    const greenCoverage = summarizeMetric(
      features?.greenCoverage ?? null,
    );
    const waterfrontProximity = summarizeMetric(
      features?.waterfrontProximity ?? null,
    );
    const builtUpExposure = summarizeMetric(
      features?.builtUpExposure ?? null,
    );
    if (
      cappedSource.readCount !== MAX_RASTER_READS ||
      features?.availability !== "partial" ||
      features.roadComfort !== null ||
      greenCoverage === null ||
      waterfrontProximity === null ||
      builtUpExposure === null
    ) {
      return {
        status: "failed",
        code: "WORLDCOVER_SMOKE_VALIDATION_FAILED",
        rasterReadCount: cappedSource.readCount,
      };
    }
    return {
      status: "passed",
      rasterReadCount: 1,
      availability: "partial",
      greenCoverage,
      waterfrontProximity,
      builtUpExposure,
      roadComfortMissing: true,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "WORLDCOVER_SMOKE_READ_LIMIT_EXCEEDED"
    ) {
      return {
        status: "failed",
        code: "WORLDCOVER_SMOKE_READ_LIMIT_EXCEEDED",
        rasterReadCount: cappedSource.readCount,
      };
    }
    if (error instanceof ProviderError) {
      return {
        status: "failed",
        code: error.code,
        rasterReadCount: cappedSource.readCount,
      };
    }
    return {
      status: "failed",
      code: "WORLDCOVER_SMOKE_UNEXPECTED_ERROR",
      rasterReadCount: cappedSource.readCount,
    };
  }
}

async function main() {
  const result = await runWorldCoverSmoke({ enabled: true });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
