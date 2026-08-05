import type { ProviderCallContext } from "../route-recommendation/ports.ts";
import {
  validateWorldCoverGrid,
  type WorldCoverGrid,
  type WorldCoverGridRequest,
  type WorldCoverRasterSource,
} from "../adapters/worldcover/rasterSource.ts";
import type { R2BucketBinding } from "./bindings.ts";

const DEFAULT_SOURCE_VERSION = "2021-v200";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;

type CacheMetadata = Readonly<{
  sourceVersion: string;
  minLongitude: string;
  minLatitude: string;
  maxLongitude: string;
  maxLatitude: string;
  width: string;
  height: string;
  expiresAt: string;
}>;

export type R2WorldCoverCacheOptions = Readonly<{
  bucket: R2BucketBinding;
  source: WorldCoverRasterSource;
  sourceVersion?: string;
  ttlMs?: number;
  now?: () => number;
  defer?: (promise: Promise<unknown>) => void;
}>;

function coordinates(request: WorldCoverGridRequest): readonly string[] {
  return [
    request.bounds.minLongitude,
    request.bounds.minLatitude,
    request.bounds.maxLongitude,
    request.bounds.maxLatitude,
  ].map(String);
}

function cacheKey(
  request: WorldCoverGridRequest,
  sourceVersion: string,
): string {
  return `worldcover-grid/${encodeURIComponent(sourceVersion)}/${encodeURIComponent(
    JSON.stringify([...coordinates(request), request.width, request.height]),
  )}.bin`;
}

function metadataFor(
  request: WorldCoverGridRequest,
  sourceVersion: string,
  expiresAt: number,
): CacheMetadata {
  const [minLongitude, minLatitude, maxLongitude, maxLatitude] =
    coordinates(request);
  return {
    sourceVersion,
    minLongitude,
    minLatitude,
    maxLongitude,
    maxLatitude,
    width: String(request.width),
    height: String(request.height),
    expiresAt: String(expiresAt),
  };
}

function matches(
  actual: Readonly<Record<string, string>> | undefined,
  expected: CacheMetadata,
  now: number,
): boolean {
  if (!actual) return false;
  const expiresAt = Number(actual.expiresAt);
  return (
    Number.isSafeInteger(expiresAt) &&
    expiresAt > now &&
    Object.entries(expected).every(
      ([key, value]) =>
        key === "expiresAt" || actual[key] === value,
    )
  );
}

export class R2CachedWorldCoverRasterSource
  implements WorldCoverRasterSource
{
  private readonly bucket: R2BucketBinding;
  private readonly source: WorldCoverRasterSource;
  private readonly sourceVersion: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly defer?: (promise: Promise<unknown>) => void;

  constructor(options: R2WorldCoverCacheOptions) {
    this.bucket = options.bucket;
    this.source = options.source;
    this.sourceVersion =
      options.sourceVersion ?? DEFAULT_SOURCE_VERSION;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.defer = options.defer;
    if (!this.sourceVersion.trim()) {
      throw new TypeError("WORLDCOVER_SOURCE_VERSION_REQUIRED");
    }
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 60_000) {
      throw new RangeError("WORLDCOVER_R2_CACHE_TTL_INVALID");
    }
  }

  async readGrid(
    request: WorldCoverGridRequest,
    context: ProviderCallContext,
  ): Promise<WorldCoverGrid> {
    const key = cacheKey(request, this.sourceVersion);
    const expectedMetadata = metadataFor(
      request,
      this.sourceVersion,
      this.now() + this.ttlMs,
    );
    try {
      const cached = await this.bucket.get(key);
      context.signal?.throwIfAborted();
      if (
        cached &&
        matches(cached.customMetadata, expectedMetadata, this.now())
      ) {
        const values = new Uint8Array(await cached.arrayBuffer());
        const grid = {
          bounds: request.bounds,
          width: request.width,
          height: request.height,
          values,
        } satisfies WorldCoverGrid;
        validateWorldCoverGrid(grid, "worldcover-scenery");
        return grid;
      }
    } catch (error) {
      if (context.signal?.aborted) throw error;
      // R2 is an optimization; a cache fault must not disable routing.
    }

    const grid = await this.source.readGrid(request, context);
    validateWorldCoverGrid(grid, "worldcover-scenery");
    const values = grid.values.slice();
    const write = this.bucket
      .put(key, values, {
        httpMetadata: {
          contentType: "application/octet-stream",
        },
        customMetadata: expectedMetadata,
      })
      .catch(() => undefined);
    if (this.defer) {
      this.defer(write);
    } else {
      await write;
    }
    return grid;
  }
}
