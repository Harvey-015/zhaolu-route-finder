import { pathToFileURL } from "node:url";

type LoadTestFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type LoadProfile = "edge-read" | "route-plan";

type LoadTestConfig = Readonly<{
  origin: URL;
  profile: LoadProfile;
  requests: number;
  concurrency: number;
  p95LimitMs: number;
  minimumSuccessRate: number;
  startQuery: string;
}>;

export type LoadTestOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  fetcher?: LoadTestFetch;
  now?: () => number;
}>;

type LoadTestResult = Readonly<{
  status: "passed" | "failed";
  profile?: LoadProfile;
  requestCount: number;
  concurrency?: number;
  successRate?: number;
  latencyMs?: Readonly<{
    average: number;
    p50: number;
    p95: number;
    p99: number;
    maximum: number;
  }>;
  statusCounts?: Readonly<Record<string, number>>;
  code?: string;
}>;

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error("LOAD_TEST_CONFIGURATION_INVALID");
  }
  return value;
}

function loadConfig(environment: NodeJS.ProcessEnv): LoadTestConfig {
  const rawOrigin = environment.LOAD_TEST_BASE_URL?.trim() ?? "";
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("LOAD_TEST_CONFIGURATION_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("LOAD_TEST_CONFIGURATION_INVALID");
  }
  const profile = environment.LOAD_TEST_PROFILE?.trim() || "edge-read";
  if (profile !== "edge-read" && profile !== "route-plan") {
    throw new Error("LOAD_TEST_CONFIGURATION_INVALID");
  }
  if (
    profile === "route-plan" &&
    environment.LOAD_TEST_CONFIRMATION?.trim() !==
      "staging-only-provider-quota-approved"
  ) {
    throw new Error("LOAD_TEST_CONFIGURATION_INVALID");
  }
  const maximumRequests = profile === "route-plan" ? 50 : 1_000;
  const maximumConcurrency = profile === "route-plan" ? 5 : 50;
  const requests = integer(
    environment,
    "LOAD_TEST_REQUESTS",
    profile === "route-plan" ? 10 : 200,
    1,
    maximumRequests,
  );
  const concurrency = integer(
    environment,
    "LOAD_TEST_CONCURRENCY",
    profile === "route-plan" ? 2 : 20,
    1,
    Math.min(maximumConcurrency, requests),
  );
  const startQuery =
    environment.LOAD_TEST_START_QUERY?.trim() || "杭州黄龙体育中心";
  if (startQuery.length < 2 || startQuery.length > 200) {
    throw new Error("LOAD_TEST_CONFIGURATION_INVALID");
  }
  const minimumSuccessPercent = integer(
    environment,
    "LOAD_TEST_MIN_SUCCESS_PERCENT",
    99,
    1,
    100,
  );
  return Object.freeze({
    origin,
    profile,
    requests,
    concurrency,
    p95LimitMs: integer(
      environment,
      "LOAD_TEST_P95_LIMIT_MS",
      profile === "route-plan" ? 15_000 : 1_000,
      1,
      120_000,
    ),
    minimumSuccessRate: minimumSuccessPercent / 100,
    startQuery,
  });
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function requestFor(
  config: LoadTestConfig,
  index: number,
): Readonly<{ url: URL; init: RequestInit }> {
  if (config.profile === "edge-read") {
    return {
      url: new URL("/api/v1/ready", config.origin),
      init: {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    };
  }
  const requestId = `load-test-${index + 1}`;
  return {
    url: new URL("/api/v1/routes/plan", config.origin),
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "zhaolu-load-test/1",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        schemaVersion: "1",
        requestId,
        start: { kind: "query", query: config.startQuery },
        mode: "running",
        targetDistanceMeters: 2_000,
        maxResults: 1,
        preferences: {
          greenery: 1,
          waterfront: 0.8,
          lowTraffic: 0.7,
          comfort: 0.5,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  };
}

async function validResponse(
  response: Response,
  profile: LoadProfile,
): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (profile === "edge-read") return body.status === "ready";
    return (
      body.schemaVersion === "1" &&
      (body.status === "complete" || body.status === "partial") &&
      Array.isArray(body.routes) &&
      body.routes.length >= 1
    );
  } catch {
    return false;
  }
}

export async function runLoadTest(
  options: LoadTestOptions = {},
): Promise<LoadTestResult> {
  let config: LoadTestConfig;
  try {
    config = loadConfig(options.environment ?? process.env);
  } catch {
    return {
      status: "failed",
      requestCount: 0,
      code: "LOAD_TEST_CONFIGURATION_INVALID",
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const durations = new Array<number>(config.requests).fill(0);
  const statuses = new Array<string>(config.requests).fill("network-error");
  const successes = new Array<boolean>(config.requests).fill(false);
  let cursor = 0;
  const workers = Array.from(
    { length: config.concurrency },
    async () => {
      while (cursor < config.requests) {
        const index = cursor;
        cursor += 1;
        const request = requestFor(config, index);
        const startedAt = now();
        try {
          const response = await fetcher(request.url, request.init);
          statuses[index] = String(response.status);
          successes[index] = await validResponse(
            response,
            config.profile,
          );
        } catch {
          statuses[index] = "network-error";
        } finally {
          durations[index] = Math.max(0, now() - startedAt);
        }
      }
    },
  );
  await Promise.all(workers);

  const sorted = [...durations].sort((left, right) => left - right);
  const successCount = successes.filter(Boolean).length;
  const successRate = successCount / config.requests;
  const latencyMs = Object.freeze({
    average:
      Math.round(
        (durations.reduce((sum, value) => sum + value, 0) /
          durations.length) *
          1_000,
      ) / 1_000,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maximum: sorted.at(-1) ?? 0,
  });
  const statusCounts: Record<string, number> = {};
  statuses.forEach((status) => {
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  });
  const passed =
    successRate >= config.minimumSuccessRate &&
    latencyMs.p95 <= config.p95LimitMs;
  return {
    status: passed ? "passed" : "failed",
    profile: config.profile,
    requestCount: config.requests,
    concurrency: config.concurrency,
    successRate,
    latencyMs,
    statusCounts: Object.freeze(statusCounts),
    ...(passed ? {} : { code: "LOAD_TEST_THRESHOLDS_FAILED" }),
  };
}

async function main() {
  const result = await runLoadTest();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
