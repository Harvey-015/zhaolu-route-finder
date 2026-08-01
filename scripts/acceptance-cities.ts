import { pathToFileURL } from "node:url";
import type {
  ApiRecommendedRoute,
  PlanRoutesApiResponse,
} from "../src/server-api/contracts.ts";

type AcceptanceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type CityCase = Readonly<{
  name: string;
  startQuery: string;
  mode: "running" | "cycling";
  targetDistanceMeters: number;
}>;

const DEFAULT_CITY_CASES: readonly CityCase[] = Object.freeze([
  {
    name: "杭州",
    startQuery: "杭州西湖断桥",
    mode: "running",
    targetDistanceMeters: 5_000,
  },
  {
    name: "上海",
    startQuery: "上海世纪公园",
    mode: "running",
    targetDistanceMeters: 5_000,
  },
  {
    name: "成都",
    startQuery: "成都青龙湖湿地公园",
    mode: "cycling",
    targetDistanceMeters: 12_000,
  },
]);

export type CityAcceptanceOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  fetcher?: AcceptanceFetch;
  now?: () => number;
}>;

type CityAcceptanceResult = Readonly<{
  status: "passed" | "failed";
  requestCount: number;
  cases: readonly Readonly<{
    name: string;
    responseStatus: "complete" | "partial";
    routeCount: number;
    elapsedMs: number;
  }>[];
  code?: string;
}>;

function validCase(value: unknown): value is CityCase {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CityCase>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length >= 1 &&
    candidate.name.length <= 40 &&
    typeof candidate.startQuery === "string" &&
    candidate.startQuery.length >= 2 &&
    candidate.startQuery.length <= 200 &&
    (candidate.mode === "running" || candidate.mode === "cycling") &&
    typeof candidate.targetDistanceMeters === "number" &&
    Number.isInteger(candidate.targetDistanceMeters) &&
    candidate.targetDistanceMeters >= 1_000 &&
    candidate.targetDistanceMeters <=
      (candidate.mode === "running" ? 50_000 : 200_000)
  );
}

function cases(environment: NodeJS.ProcessEnv): readonly CityCase[] {
  const raw = environment.CITY_ACCEPTANCE_CASES_JSON?.trim();
  if (!raw) return DEFAULT_CITY_CASES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CITY_ACCEPTANCE_CONFIGURATION_INVALID");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > 5 ||
    !parsed.every(validCase)
  ) {
    throw new Error("CITY_ACCEPTANCE_CONFIGURATION_INVALID");
  }
  return Object.freeze(parsed);
}

function origin(environment: NodeJS.ProcessEnv): URL {
  if (
    environment.CITY_ACCEPTANCE_CONFIRMATION?.trim() !==
    "staging-only-three-live-requests-approved"
  ) {
    throw new Error("CITY_ACCEPTANCE_CONFIGURATION_INVALID");
  }
  const raw = environment.CITY_ACCEPTANCE_BASE_URL?.trim() ?? "";
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new Error("CITY_ACCEPTANCE_CONFIGURATION_INVALID");
  }
  if (
    value.protocol !== "https:" ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash
  ) {
    throw new Error("CITY_ACCEPTANCE_CONFIGURATION_INVALID");
  }
  return value;
}

function validCoordinate(value: readonly number[]): boolean {
  return (
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= 72 &&
    value[0] <= 136 &&
    value[1] >= 3 &&
    value[1] <= 54
  );
}

function validateRoute(route: ApiRecommendedRoute, testCase: CityCase) {
  const lowerDistance = testCase.targetDistanceMeters * 0.5;
  const upperDistance = testCase.targetDistanceMeters * 1.75;
  if (
    typeof route.id !== "string" ||
    !route.id ||
    route.geometry?.type !== "LineString" ||
    !Array.isArray(route.geometry.coordinates) ||
    route.geometry.coordinates.length < 2 ||
    !route.geometry.coordinates.every(validCoordinate) ||
    !Number.isFinite(route.distanceMeters) ||
    route.distanceMeters < lowerDistance ||
    route.distanceMeters > upperDistance ||
    route.source?.providerId !== "amap-route" ||
    !Number.isFinite(route.score?.total)
  ) {
    throw new Error("CITY_ACCEPTANCE_ROUTE_INVALID");
  }
}

function validateResponse(
  value: unknown,
  requestId: string,
  testCase: CityCase,
): PlanRoutesApiResponse {
  if (!value || typeof value !== "object") {
    throw new Error("CITY_ACCEPTANCE_RESPONSE_INVALID");
  }
  const response = value as PlanRoutesApiResponse;
  if (
    response.schemaVersion !== "1" ||
    response.requestId !== requestId ||
    (response.status !== "complete" && response.status !== "partial") ||
    !Array.isArray(response.routes) ||
    response.routes.length < 1 ||
    response.routes.length > 3
  ) {
    throw new Error("CITY_ACCEPTANCE_RESPONSE_INVALID");
  }
  response.routes.forEach((route) => validateRoute(route, testCase));
  if (new Set(response.routes.map(({ id }) => id)).size !== response.routes.length) {
    throw new Error("CITY_ACCEPTANCE_ROUTE_DUPLICATE");
  }
  return response;
}

export async function runCityAcceptance(
  options: CityAcceptanceOptions = {},
): Promise<CityAcceptanceResult> {
  const environment = options.environment ?? process.env;
  let baseUrl: URL;
  let cityCases: readonly CityCase[];
  try {
    baseUrl = origin(environment);
    cityCases = cases(environment);
  } catch {
    return {
      status: "failed",
      requestCount: 0,
      cases: [],
      code: "CITY_ACCEPTANCE_CONFIGURATION_INVALID",
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const results: Array<{
    name: string;
    responseStatus: "complete" | "partial";
    routeCount: number;
    elapsedMs: number;
  }> = [];
  let requestCount = 0;
  try {
    for (const [index, testCase] of cityCases.entries()) {
      const requestId = `city-acceptance-${index + 1}-${now()}`;
      const startedAt = now();
      requestCount += 1;
      const response = await fetcher(
        new URL("/api/v1/routes/plan", baseUrl),
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "user-agent": "zhaolu-city-acceptance/1",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            schemaVersion: "1",
            requestId,
            start: { kind: "query", query: testCase.startQuery },
            mode: testCase.mode,
            targetDistanceMeters: testCase.targetDistanceMeters,
            maxResults: 3,
            preferences: {
              greenery: 1,
              waterfront: 0.8,
              lowTraffic: 0.7,
              comfort: 0.5,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!response.ok) {
        throw new Error("CITY_ACCEPTANCE_HTTP_FAILURE");
      }
      const body = validateResponse(
        await response.json(),
        requestId,
        testCase,
      );
      results.push({
        name: testCase.name,
        responseStatus: body.status,
        routeCount: body.routes.length,
        elapsedMs: Math.max(0, now() - startedAt),
      });
    }
    return {
      status: "passed",
      requestCount,
      cases: results,
    };
  } catch {
    return {
      status: "failed",
      requestCount,
      cases: results,
      code: "CITY_ACCEPTANCE_REQUEST_FAILED",
    };
  }
}

async function main() {
  const result = await runCityAcceptance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
