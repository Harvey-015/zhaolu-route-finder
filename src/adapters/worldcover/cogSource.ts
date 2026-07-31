import { fromUrl } from "geotiff";
import { ProviderError } from "../../route-recommendation/errors.ts";
import type { ProviderCallContext } from "../../route-recommendation/ports.ts";
import { worldCoverProviderError } from "./errors.ts";
import {
  isWorldCoverClassCode,
  validateWorldCoverBounds,
  type WorldCoverBounds,
  type WorldCoverGrid,
  type WorldCoverGridRequest,
  type WorldCoverRasterSource,
} from "./rasterSource.ts";

const DEFAULT_BASE_URL =
  "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TILES = 16;
const DEFAULT_MAX_GRID_DIMENSION = 320;
const TILE_SIZE_DEGREES = 3;

export type WorldCoverTileReadRequest = Readonly<{
  url: URL;
  bounds: WorldCoverBounds;
  width: number;
  height: number;
  signal: AbortSignal;
}>;

export type WorldCoverTileReader = (
  request: WorldCoverTileReadRequest,
) => Promise<ArrayLike<number>>;

export type CogWorldCoverRasterSourceOptions = Readonly<{
  providerId?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxTiles?: number;
  maxGridDimension?: number;
  tileReader?: WorldCoverTileReader;
}>;

function assertPositiveInteger(
  value: number,
  errorCode: string,
): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(errorCode);
  }
}

function defaultTileReader(
  request: WorldCoverTileReadRequest,
): Promise<ArrayLike<number>> {
  return readCogWindow(request);
}

async function readCogWindow(
  request: WorldCoverTileReadRequest,
): Promise<ArrayLike<number>> {
  const tiff = await fromUrl(
    request.url.toString(),
    {
      maxRanges: 4,
      allowFullFile: false,
    },
    request.signal,
  );
  try {
    const rasters = await tiff.readRasters({
      bbox: [
        request.bounds.minLongitude,
        request.bounds.minLatitude,
        request.bounds.maxLongitude,
        request.bounds.maxLatitude,
      ],
      width: request.width,
      height: request.height,
      samples: [0],
      interleave: true,
      resampleMethod: "nearest",
      fillValue: 0,
      signal: request.signal,
    });
    if (Array.isArray(rasters)) {
      throw new TypeError("WORLDCOVER_INTERLEAVED_RASTER_REQUIRED");
    }
    return rasters as ArrayLike<number>;
  } finally {
    await tiff.close();
  }
}

function tileOrigin(value: number): number {
  return Math.floor(value / TILE_SIZE_DEGREES) * TILE_SIZE_DEGREES;
}

function tileOrigins(minimum: number, maximum: number): number[] {
  const result: number[] = [];
  const first = tileOrigin(minimum);
  const last = tileOrigin(maximum - 1e-10);
  for (
    let value = first;
    value <= last;
    value += TILE_SIZE_DEGREES
  ) {
    result.push(Object.is(value, -0) ? 0 : value);
  }
  return result;
}

function tileName(
  latitudeOrigin: number,
  longitudeOrigin: number,
): string {
  const latitudeHemisphere = latitudeOrigin < 0 ? "S" : "N";
  const longitudeHemisphere = longitudeOrigin < 0 ? "W" : "E";
  return [
    "ESA_WorldCover_10m_2021_v200_",
    latitudeHemisphere,
    Math.abs(latitudeOrigin).toString().padStart(2, "0"),
    longitudeHemisphere,
    Math.abs(longitudeOrigin).toString().padStart(3, "0"),
    "_Map.tif",
  ].join("");
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(signal.reason),
      { once: true },
    );
  });
}

export class CogWorldCoverRasterSource
  implements WorldCoverRasterSource
{
  private readonly providerId: string;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxTiles: number;
  private readonly maxGridDimension: number;
  private readonly tileReader: WorldCoverTileReader;

  constructor(options: CogWorldCoverRasterSourceOptions = {}) {
    this.providerId = options.providerId ?? "worldcover-scenery";
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new TypeError("WORLDCOVER_BASE_URL_INVALID");
    }
    this.baseUrl = new URL(
      baseUrl.pathname.endsWith("/") ? baseUrl.toString() : `${baseUrl}/`,
    );
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTiles = options.maxTiles ?? DEFAULT_MAX_TILES;
    this.maxGridDimension =
      options.maxGridDimension ?? DEFAULT_MAX_GRID_DIMENSION;
    assertPositiveInteger(
      this.timeoutMs,
      "WORLDCOVER_TIMEOUT_INVALID",
    );
    assertPositiveInteger(
      this.maxTiles,
      "WORLDCOVER_MAX_TILES_INVALID",
    );
    assertPositiveInteger(
      this.maxGridDimension,
      "WORLDCOVER_MAX_GRID_DIMENSION_INVALID",
    );
    this.tileReader = options.tileReader ?? defaultTileReader;
  }

  async readGrid(
    request: WorldCoverGridRequest,
    context: ProviderCallContext,
  ): Promise<WorldCoverGrid> {
    validateWorldCoverBounds(request.bounds);
    assertPositiveInteger(request.width, "WORLDCOVER_WIDTH_INVALID");
    assertPositiveInteger(request.height, "WORLDCOVER_HEIGHT_INVALID");
    if (
      request.width > this.maxGridDimension ||
      request.height > this.maxGridDimension
    ) {
      throw new RangeError("WORLDCOVER_GRID_TOO_LARGE");
    }
    if (context.signal?.aborted) {
      throw worldCoverProviderError(this.providerId, "ABORTED");
    }

    const latitudeOrigins = tileOrigins(
      request.bounds.minLatitude,
      request.bounds.maxLatitude,
    );
    const longitudeOrigins = tileOrigins(
      request.bounds.minLongitude,
      request.bounds.maxLongitude,
    );
    if (
      latitudeOrigins.length * longitudeOrigins.length >
      this.maxTiles
    ) {
      throw worldCoverProviderError(
        this.providerId,
        "UNAVAILABLE",
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("WORLDCOVER_TIMEOUT"));
    }, this.timeoutMs);

    try {
      const values = new Uint8Array(request.width * request.height);
      for (const latitudeOrigin of latitudeOrigins) {
        for (const longitudeOrigin of longitudeOrigins) {
          const url = new URL(
            tileName(latitudeOrigin, longitudeOrigin),
            this.baseUrl,
          );
          const raster = await Promise.race([
            this.tileReader({
              url,
              bounds: request.bounds,
              width: request.width,
              height: request.height,
              signal: controller.signal,
            }),
            abortPromise(controller.signal),
          ]);
          if (raster.length !== values.length) {
            throw worldCoverProviderError(
              this.providerId,
              "INVALID_RESPONSE",
            );
          }
          for (let index = 0; index < raster.length; index += 1) {
            const value = raster[index];
            if (
              typeof value !== "number" ||
              !isWorldCoverClassCode(value)
            ) {
              throw worldCoverProviderError(
                this.providerId,
                "INVALID_RESPONSE",
              );
            }
            if (value !== 0) values[index] = value;
          }
        }
      }

      return {
        bounds: request.bounds,
        width: request.width,
        height: request.height,
        values,
      };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (context.signal?.aborted) {
        throw worldCoverProviderError(
          this.providerId,
          "ABORTED",
          error,
        );
      }
      if (timedOut) {
        throw worldCoverProviderError(
          this.providerId,
          "TIMEOUT",
          error,
        );
      }
      throw worldCoverProviderError(
        this.providerId,
        "UNAVAILABLE",
        error,
      );
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener(
        "abort",
        abortFromCaller,
      );
    }
  }
}
