import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { generateDirectionalCandidates } from "../src/route-recommendation/candidateGeneration.ts";
import { wgs84Point } from "../src/route-recommendation/coordinates.ts";
import { selectDiverseRoutes } from "../src/route-recommendation/diversity.ts";
import {
  FakePlaceProvider,
  FakeRouteProvider,
  FakeSceneryProvider,
} from "../src/route-recommendation/fakes.ts";
import { findScenicRoutes } from "../src/route-recommendation/findScenicRoutes.ts";
import { ScenicScoreV1 } from "../src/route-recommendation/scoring.ts";
import { resolveFixtureRouteDeliveryPolicy } from "../src/route-delivery/policy.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import { createNodeApiServer } from "../src/server-api/nodeServer.ts";

export type ServerApiSmokeResult =
  | Readonly<{
      status: "passed";
      httpRequestCount: 3;
      planCallCount: 1;
      routeCount: number;
      geometryType: "LineString";
      requestIdPreserved: true;
    }>
  | Readonly<{
      status: "failed";
      code:
        | "SERVER_API_HEALTH_FAILED"
        | "SERVER_API_CAPABILITIES_FAILED"
        | "SERVER_API_PLAN_FAILED"
        | "SERVER_API_UNEXPECTED_ERROR";
      httpRequestCount: number;
      planCallCount: number;
    }>;

export function createFixturePlanner() {
  const placeProvider = new FakePlaceProvider({
    杭州西湖: {
      id: "fixture:hangzhou-west-lake",
      name: "杭州西湖",
      point: wgs84Point(120.148, 30.244),
      source: {
        providerId: "fixture-place",
      },
    },
  });
  const routeProvider = new FakeRouteProvider();
  const sceneryProvider = new FakeSceneryProvider();
  const scoringPolicy = new ScenicScoreV1();
  let callCount = 0;

  return {
    get callCount() {
      return callCount;
    },
    planRoutes: async (
      request: Parameters<typeof findScenicRoutes>[0],
      signal?: AbortSignal,
    ) => {
      callCount += 1;
      return findScenicRoutes(request, {
        placeProvider,
        routeProvider,
        sceneryProvider,
        scoringPolicy,
        candidateGenerationStrategy: generateDirectionalCandidates,
        routeSelectionStrategy: selectDiverseRoutes,
        signal,
      });
    },
  };
}

async function listen(server: ReturnType<typeof createNodeApiServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

async function close(server: ReturnType<typeof createNodeApiServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function runServerApiSmoke(): Promise<ServerApiSmokeResult> {
  const planner = createFixturePlanner();
  const server = createNodeApiServer(
    createServerApi({
      planRoutes: planner.planRoutes,
      requestIdFactory: () => "server-api-generated",
      deliveryPolicyResolver: resolveFixtureRouteDeliveryPolicy,
    }),
  );
  let httpRequestCount = 0;

  try {
    await listen(server);
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    httpRequestCount += 1;
    const health = await fetch(`${baseUrl}/api/v1/health`);
    const healthBody = (await health.json()) as Record<string, unknown>;
    if (!health.ok || healthBody.status !== "ok") {
      return {
        status: "failed",
        code: "SERVER_API_HEALTH_FAILED",
        httpRequestCount,
        planCallCount: planner.callCount,
      };
    }

    httpRequestCount += 1;
    const capabilities = await fetch(
      `${baseUrl}/api/v1/capabilities`,
    );
    const capabilitiesBody =
      (await capabilities.json()) as Record<string, unknown>;
    if (
      !capabilities.ok ||
      capabilitiesBody.coordinateReferenceSystem !== "WGS84"
    ) {
      return {
        status: "failed",
        code: "SERVER_API_CAPABILITIES_FAILED",
        httpRequestCount,
        planCallCount: planner.callCount,
      };
    }

    httpRequestCount += 1;
    const planned = await fetch(`${baseUrl}/api/v1/routes/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "1",
        requestId: "server-api-smoke",
        start: {
          kind: "point",
          longitude: 120.145,
          latitude: 30.26,
          crs: "WGS84",
          label: "Smoke start",
        },
        mode: "running",
        targetDistanceMeters: 5_000,
        preferences: {
          greenery: 1,
          waterfront: 1,
          lowTraffic: 1,
          comfort: 1,
        },
        maxResults: 2,
      }),
    });
    const plannedBody = (await planned.json()) as {
      requestId?: string;
      routes?: Array<{ geometry?: { type?: string } }>;
    };
    const routeCount = plannedBody.routes?.length ?? 0;
    if (
      !planned.ok ||
      planner.callCount !== 1 ||
      plannedBody.requestId !== "server-api-smoke" ||
      routeCount < 1 ||
      plannedBody.routes?.[0]?.geometry?.type !== "LineString"
    ) {
      return {
        status: "failed",
        code: "SERVER_API_PLAN_FAILED",
        httpRequestCount,
        planCallCount: planner.callCount,
      };
    }

    return {
      status: "passed",
      httpRequestCount: 3,
      planCallCount: 1,
      routeCount,
      geometryType: "LineString",
      requestIdPreserved: true,
    };
  } catch {
    return {
      status: "failed",
      code: "SERVER_API_UNEXPECTED_ERROR",
      httpRequestCount,
      planCallCount: planner.callCount,
    };
  } finally {
    if (server.listening) await close(server);
  }
}

async function main() {
  const result = await runServerApiSmoke();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
