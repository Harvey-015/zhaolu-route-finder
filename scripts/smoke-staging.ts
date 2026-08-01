import { pathToFileURL } from "node:url";

type StagingFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type StagingSmokeResult =
  | Readonly<{
      status: "passed";
      requestCount: 8;
      checks: readonly string[];
      routeCount: number;
      webMapEnabled: boolean;
      routeExportsAllowed: boolean;
    }>
  | Readonly<{
      status: "failed";
      requestCount: number;
      checks: readonly string[];
      code: string;
    }>;

export type StagingSmokeOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  fetcher?: StagingFetch;
}>;

type SmokeConfig = Readonly<{
  origin: URL;
  startQuery: string;
  expectWebMap: boolean;
  expectRouteExports: boolean;
}>;

class StagingSmokeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StagingSmokeError";
    this.code = code;
  }
}

function booleanValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const value = environment[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new StagingSmokeError("STAGING_CONFIGURATION_INVALID");
}

function smokeConfig(environment: NodeJS.ProcessEnv): SmokeConfig {
  const raw = environment.STAGING_BASE_URL?.trim() ?? "";
  if (!raw) {
    throw new StagingSmokeError("STAGING_CONFIGURATION_INVALID");
  }
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    throw new StagingSmokeError("STAGING_CONFIGURATION_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new StagingSmokeError("STAGING_CONFIGURATION_INVALID");
  }
  const startQuery =
    environment.STAGING_SMOKE_START_QUERY?.trim() ||
    "杭州黄龙体育中心";
  if (startQuery.length > 200) {
    throw new StagingSmokeError("STAGING_CONFIGURATION_INVALID");
  }
  return {
    origin,
    startQuery,
    expectWebMap: booleanValue(
      environment,
      "STAGING_EXPECT_WEB_MAP",
      true,
    ),
    expectRouteExports: booleanValue(
      environment,
      "STAGING_EXPECT_ROUTE_EXPORTS",
      false,
    ),
  };
}

function objectValue(value: unknown, code: string) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new StagingSmokeError(code);
  }
  return value as Record<string, unknown>;
}

function assertApiHeaders(response: Response, code: string) {
  if (
    response.headers.get("cache-control") !== "no-store" ||
    response.headers.get("x-content-type-options") !== "nosniff"
  ) {
    throw new StagingSmokeError(code);
  }
}

function hasSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /securitycode|servicekey|secret|authorization/i.test(key) ||
      hasSensitiveKey(nested),
  );
}

function validCoordinates(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  return value.every(
    (point) =>
      Array.isArray(point) &&
      point.length === 2 &&
      typeof point[0] === "number" &&
      Number.isFinite(point[0]) &&
      point[0] >= -180 &&
      point[0] <= 180 &&
      typeof point[1] === "number" &&
      Number.isFinite(point[1]) &&
      point[1] >= -90 &&
      point[1] <= 90,
  );
}

export async function runStagingSmoke(
  options: StagingSmokeOptions = {},
): Promise<StagingSmokeResult> {
  const environment = options.environment ?? process.env;
  let config: SmokeConfig;
  try {
    config = smokeConfig(environment);
  } catch (error) {
    return {
      status: "failed",
      requestCount: 0,
      checks: [],
      code:
        error instanceof StagingSmokeError
          ? error.code
          : "STAGING_CONFIGURATION_INVALID",
    };
  }

  const fetcher = options.fetcher ?? globalThis.fetch;
  let requestCount = 0;
  const checks: string[] = [];
  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    requestCount += 1;
    const headers = new Headers(init.headers);
    headers.set("user-agent", "zhaolu-staging-smoke/1");
    const response = await fetcher(new URL(path, config.origin), {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      throw new StagingSmokeError("STAGING_HTTP_FAILURE");
    }
    return response;
  };
  const requestJson = async (
    path: string,
    code: string,
    init: RequestInit = {},
  ) => {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    const response = await request(path, { ...init, headers });
    assertApiHeaders(response, code);
    try {
      return objectValue(await response.json(), code);
    } catch (error) {
      if (error instanceof StagingSmokeError) throw error;
      throw new StagingSmokeError(code);
    }
  };

  try {
    const health = await requestJson(
      "/api/v1/health",
      "STAGING_HEALTH_INVALID",
    );
    if (health.status !== "ok") {
      throw new StagingSmokeError("STAGING_HEALTH_INVALID");
    }
    checks.push("health");

    const readiness = await requestJson(
      "/api/v1/ready",
      "STAGING_READINESS_INVALID",
    );
    if (readiness.status !== "ready") {
      throw new StagingSmokeError("STAGING_READINESS_INVALID");
    }
    checks.push("ready");

    const capabilities = await requestJson(
      "/api/v1/capabilities",
      "STAGING_CAPABILITIES_INVALID",
    );
    const webMap = objectValue(
      capabilities.webMap,
      "STAGING_CAPABILITIES_INVALID",
    );
    if (
      capabilities.coordinateReferenceSystem !== "WGS84" ||
      capabilities.geometryFormat !== "GeoJSON" ||
      webMap.available !== config.expectWebMap
    ) {
      throw new StagingSmokeError("STAGING_CAPABILITIES_INVALID");
    }
    checks.push("capabilities");

    const mapConfig = await requestJson(
      "/api/v1/map-config",
      "STAGING_MAP_CONFIG_INVALID",
    );
    if (
      mapConfig.enabled !== config.expectWebMap ||
      hasSensitiveKey(mapConfig) ||
      (config.expectWebMap &&
        (mapConfig.providerId !== "amap-jsapi" ||
          typeof mapConfig.key !== "string" ||
          mapConfig.key.length === 0 ||
          mapConfig.serviceHost !== "/_AMapService"))
    ) {
      throw new StagingSmokeError("STAGING_MAP_CONFIG_INVALID");
    }
    checks.push("map-config");

    const legalConfig = await requestJson(
      "/api/v1/legal-config",
      "STAGING_LEGAL_CONFIG_INVALID",
    );
    if (
      legalConfig.configured !== true ||
      typeof legalConfig.documentVersion !== "string" ||
      typeof legalConfig.operatorName !== "string" ||
      legalConfig.operatorName.length === 0 ||
      typeof legalConfig.privacyContact !== "string" ||
      legalConfig.privacyContact.length === 0 ||
      typeof legalConfig.logRetentionDays !== "number"
    ) {
      throw new StagingSmokeError(
        "STAGING_LEGAL_CONFIG_INVALID",
      );
    }
    checks.push("legal-config");

    const openApi = await requestJson(
      "/api/v1/openapi.json",
      "STAGING_OPENAPI_INVALID",
    );
    const paths = objectValue(
      openApi.paths,
      "STAGING_OPENAPI_INVALID",
    );
    if (
      openApi.openapi !== "3.1.0" ||
      !("/api/v1/routes/plan" in paths) ||
      !("/api/v1/map-config" in paths) ||
      !("/api/v1/legal-config" in paths)
    ) {
      throw new StagingSmokeError("STAGING_OPENAPI_INVALID");
    }
    checks.push("openapi");

    const home = await request("/");
    const contentSecurityPolicy =
      home.headers.get("content-security-policy") ?? "";
    if (
      !home.headers.get("content-type")?.startsWith("text/html") ||
      !contentSecurityPolicy.includes("default-src 'self'") ||
      !contentSecurityPolicy.includes("frame-ancestors 'none'") ||
      home.headers.get("x-content-type-options") !== "nosniff" ||
      home.headers.get("x-frame-options") !== "DENY" ||
      !home.headers.get("strict-transport-security")?.includes("max-age=")
    ) {
      throw new StagingSmokeError("STAGING_WEB_SECURITY_INVALID");
    }
    checks.push("web-security");

    const requestId = `staging-smoke-${Date.now()}`;
    const plan = await requestJson(
      "/api/v1/routes/plan",
      "STAGING_PLAN_INVALID",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          schemaVersion: "1",
          requestId,
          start: { kind: "query", query: config.startQuery },
          mode: "running",
          targetDistanceMeters: 2_000,
          preferences: {
            greenery: 1,
            waterfront: 0.8,
            lowTraffic: 0.7,
            comfort: 0.5,
          },
          maxResults: 1,
        }),
      },
    );
    if (
      plan.schemaVersion !== "1" ||
      plan.requestId !== requestId ||
      (plan.status !== "complete" && plan.status !== "partial") ||
      !Array.isArray(plan.routes) ||
      plan.routes.length < 1 ||
      plan.routes.length > 1 ||
      hasSensitiveKey(plan)
    ) {
      throw new StagingSmokeError("STAGING_PLAN_INVALID");
    }
    const expectedExports = config.expectRouteExports
      ? ["geojson", "gpx"]
      : [];
    for (const value of plan.routes) {
      const route = objectValue(value, "STAGING_PLAN_INVALID");
      const source = objectValue(
        route.source,
        "STAGING_PLAN_INVALID",
      );
      const geometry = objectValue(
        route.geometry,
        "STAGING_PLAN_INVALID",
      );
      const delivery = objectValue(
        route.delivery,
        "STAGING_PLAN_INVALID",
      );
      if (
        source.providerId !== "amap-route" ||
        geometry.type !== "LineString" ||
        !validCoordinates(geometry.coordinates) ||
        delivery.persistence !== "metadata-only" ||
        !Array.isArray(delivery.navigationTargets) ||
        !delivery.navigationTargets.includes("amap") ||
        JSON.stringify(delivery.exportFormats) !==
          JSON.stringify(expectedExports)
      ) {
        throw new StagingSmokeError("STAGING_PLAN_INVALID");
      }
    }
    checks.push("live-plan");

    return {
      status: "passed",
      requestCount: 8,
      checks,
      routeCount: plan.routes.length,
      webMapEnabled: config.expectWebMap,
      routeExportsAllowed: config.expectRouteExports,
    };
  } catch (error) {
    return {
      status: "failed",
      requestCount,
      checks,
      code:
        error instanceof StagingSmokeError
          ? error.code
          : "STAGING_REQUEST_FAILED",
    };
  }
}

async function main() {
  const result = await runStagingSmoke();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
