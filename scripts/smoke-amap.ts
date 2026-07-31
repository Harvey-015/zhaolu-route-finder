import { pathToFileURL } from "node:url";
import { destinationPoint } from "../src/route-recommendation/coordinates.ts";
import { ProviderError } from "../src/route-recommendation/errors.ts";
import type {
  RouteCandidate,
  RoutedRoute,
  TravelMode,
} from "../src/route-recommendation/models.ts";
import {
  AmapWebServiceClient,
  type AmapFetch,
} from "../src/adapters/amap/httpClient.ts";
import { AmapPlaceProvider } from "../src/adapters/amap/placeProvider.ts";
import { AmapRouteProvider } from "../src/adapters/amap/routeProvider.ts";

const PUBLIC_PLACE_QUERY = "杭州黄龙体育中心";
const MAX_HTTP_REQUESTS = 3;

type SmokeRouteSummary = Readonly<{
  geometryPointCount: number;
  distanceMeters: number;
  durationSeconds: number;
  wgs84Only: boolean;
}>;

export type AmapSmokeResult =
  | Readonly<{
      status: "skipped";
      code: "AMAP_WEB_SERVICE_KEY_MISSING";
      requestCount: 0;
    }>
  | Readonly<{
      status: "passed";
      requestCount: 3;
      placeResolved: true;
      walking: SmokeRouteSummary;
      cycling: SmokeRouteSummary;
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
        | "AMAP_SMOKE_VALIDATION_FAILED"
        | "AMAP_SMOKE_UNEXPECTED_ERROR";
      requestCount: number;
    }>;

export type AmapSmokeOptions = Readonly<{
  apiKey?: string;
  fetcher?: AmapFetch;
}>;

function candidateFor(
  mode: TravelMode,
  origin: RouteCandidate["origin"],
): RouteCandidate {
  return {
    id: `amap-smoke-${mode}`,
    origin,
    destination: destinationPoint(origin, 800, 90),
    waypoints: [],
    requiredStops: [],
    scenicAnchorIds: [],
    directionDegrees: 90,
    targetDistanceMeters: 800,
  };
}

function summarizeRoute(route: RoutedRoute): SmokeRouteSummary | null {
  const wgs84Only = route.geometry.every(({ crs }) => crs === "WGS84");
  if (
    route.geometry.length < 2 ||
    route.distanceMeters <= 0 ||
    route.durationSeconds === null ||
    route.durationSeconds < 0 ||
    !wgs84Only
  ) {
    return null;
  }
  return {
    geometryPointCount: route.geometry.length,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    wgs84Only,
  };
}

export async function runAmapSmoke(
  options: AmapSmokeOptions,
): Promise<AmapSmokeResult> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return {
      status: "skipped",
      code: "AMAP_WEB_SERVICE_KEY_MISSING",
      requestCount: 0,
    };
  }

  let requestCount = 0;
  const delegate =
    options.fetcher ??
    ((input: URL, init: RequestInit) => globalThis.fetch(input, init));
  const cappedFetcher: AmapFetch = async (input, init) => {
    if (requestCount >= MAX_HTTP_REQUESTS) {
      throw new Error("AMAP_SMOKE_REQUEST_LIMIT_EXCEEDED");
    }
    requestCount += 1;
    return delegate(input, init);
  };
  const client = new AmapWebServiceClient({
    apiKey,
    fetcher: cappedFetcher,
    maxAttempts: 1,
    timeoutMs: 10_000,
  });
  const placeProvider = new AmapPlaceProvider(client, {
    city: "杭州",
  });
  const routeProvider = new AmapRouteProvider(client, {
    maxLegsPerRoute: 1,
  });
  const context = { requestId: "amap-controlled-smoke" } as const;

  try {
    const place = await placeProvider.resolve(
      {
        input: {
          kind: "query",
          query: PUBLIC_PLACE_QUERY,
        },
      },
      context,
    );
    const walkingRoute = await routeProvider.getRoute(
      {
        candidate: candidateFor("running", place.point),
        mode: "running",
      },
      context,
    );
    const cyclingRoute = await routeProvider.getRoute(
      {
        candidate: candidateFor("cycling", place.point),
        mode: "cycling",
      },
      context,
    );
    const walking = summarizeRoute(walkingRoute);
    const cycling = summarizeRoute(cyclingRoute);
    if (!walking || !cycling || requestCount !== MAX_HTTP_REQUESTS) {
      return {
        status: "failed",
        code: "AMAP_SMOKE_VALIDATION_FAILED",
        requestCount,
      };
    }
    return {
      status: "passed",
      requestCount: 3,
      placeResolved: true,
      walking,
      cycling,
    };
  } catch (error) {
    if (error instanceof ProviderError) {
      return {
        status: "failed",
        code: error.code,
        requestCount,
      };
    }
    return {
      status: "failed",
      code: "AMAP_SMOKE_UNEXPECTED_ERROR",
      requestCount,
    };
  }
}

async function main() {
  const result = await runAmapSmoke({
    apiKey: process.env.AMAP_WEB_SERVICE_KEY,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "failed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
