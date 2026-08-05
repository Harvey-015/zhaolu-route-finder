import { CogWorldCoverRasterSource } from "../adapters/worldcover/cogSource.ts";
import { WorldCoverSceneryProvider } from "../adapters/worldcover/sceneryProvider.ts";
import { proxyAmapJsApiRequest } from "../adapters/amap/jsApiProxy.ts";
import { createRouteDeliveryPolicyResolver } from "../route-delivery/policy.ts";
import { createProductionRoutePlanner } from "../server-api/composition.ts";
import {
  createServerApi,
  type ServerApiEventLogger,
  type ServerApiHandler,
} from "../server-api/handler.ts";
import { SignedSessionService } from "../user-data/auth.ts";
import { UserDataService } from "../user-data/service.ts";
import { FixedWindowRateLimiter } from "../runtime/rateLimit.ts";
import type {
  CloudflareEnvironment,
  WorkerExecutionContextBinding,
} from "./bindings.ts";
import { D1UserDataStore } from "./d1UserDataStore.ts";
import { R2CachedWorldCoverRasterSource } from "./r2WorldCoverCache.ts";

type Runtime = Readonly<{
  api: ServerApiHandler;
  hasWebMap: boolean;
  securityCode?: string;
}>;

const runtimes = new WeakMap<object, Runtime>();
// AMap JS API 2.0 constructs its WebGL renderer dynamically. The provider
// fails with `U.Module.WebGLRender is not a constructor` without unsafe-eval.
const contentSecurityPolicy =
  "default-src 'self'; base-uri 'none'; connect-src 'self' https://*.amap.com https://*.autonavi.com; font-src 'self' data: https://*.amap.com https://*.autonavi.com; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; object-src 'none'; script-src 'self' 'unsafe-eval' https://webapi.amap.com; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new RangeError(`${name}_INVALID`);
  }
  return parsed;
}

function required(
  value: string | undefined,
  name: string,
  minimumLength = 1,
): string {
  const result = value?.trim() ?? "";
  if (result.length < minimumLength) {
    throw new RangeError(`${name}_REQUIRED`);
  }
  return result;
}

function boolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new RangeError(`${name}_INVALID`);
}

const logger: ServerApiEventLogger = {
  info(event, fields = {}) {
    console.log(JSON.stringify({ level: "info", event, ...fields }));
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: "error", event, ...fields }));
  },
};

function createRuntime(environment: CloudflareEnvironment): Runtime {
  const amapWebServiceKey = required(
    environment.AMAP_WEB_SERVICE_KEY,
    "AMAP_WEB_SERVICE_KEY",
  );
  const sessionSecret = required(
    environment.ZHAOLU_SESSION_SECRET,
    "ZHAOLU_SESSION_SECRET",
    32,
  );
  const webJsKey = environment.AMAP_WEB_JS_KEY?.trim() ?? "";
  const securityCode =
    environment.AMAP_JS_SECURITY_CODE?.trim() ?? "";
  if (Boolean(webJsKey) !== Boolean(securityCode)) {
    throw new RangeError("AMAP_WEB_MAP_CONFIGURATION_INCOMPLETE");
  }

  const store = new D1UserDataStore(environment.DB);
  const routePolicyResolver = createRouteDeliveryPolicyResolver({
    amapRouteExportsAllowed: boolean(
      environment.AMAP_ROUTE_EXPORTS_ALLOWED,
      false,
      "AMAP_ROUTE_EXPORTS_ALLOWED",
    ),
  });
  const worldCoverSource = new CogWorldCoverRasterSource({
    providerId: "worldcover-scenery",
  });
  const sceneryProvider = new WorldCoverSceneryProvider({
    rasterSource: environment.SCENERY_CACHE
      ? new R2CachedWorldCoverRasterSource({
          bucket: environment.SCENERY_CACHE,
          source: worldCoverSource,
        })
      : worldCoverSource,
  });
  const planRoutes = createProductionRoutePlanner({
    amapWebServiceKey,
    ...(environment.AMAP_CITY?.trim()
      ? { amapCity: environment.AMAP_CITY.trim() }
      : {}),
    amapMaxHttpAttemptsPerMinute: integer(
      environment.AMAP_MAX_HTTP_ATTEMPTS_PER_MINUTE,
      300,
      1,
      100_000,
      "AMAP_MAX_HTTP_ATTEMPTS_PER_MINUTE",
    ),
    sceneryProvider,
    limits: {
      maxProviderHttpAttempts: integer(
        environment.AMAP_MAX_HTTP_ATTEMPTS_PER_PLAN,
        24,
        1,
        1_000,
        "AMAP_MAX_HTTP_ATTEMPTS_PER_PLAN",
      ),
    },
  });
  const userData = new UserDataService({
    store,
    sessions: new SignedSessionService(sessionSecret),
    policyResolver: routePolicyResolver,
  });
  const api = createServerApi({
    planRoutes,
    deliveryPolicyResolver: routePolicyResolver,
    userData,
    rateLimiter: new FixedWindowRateLimiter({
      limits: {
        plan: {
          maximum: integer(
            environment.RATE_LIMIT_PLAN_PER_MINUTE,
            30,
            1,
            10_000,
            "RATE_LIMIT_PLAN_PER_MINUTE",
          ),
          windowMs: 60_000,
        },
        session: {
          maximum: integer(
            environment.RATE_LIMIT_SESSION_PER_HOUR,
            10,
            1,
            10_000,
            "RATE_LIMIT_SESSION_PER_HOUR",
          ),
          windowMs: 60 * 60_000,
        },
        "user-data": {
          maximum: integer(
            environment.RATE_LIMIT_USER_DATA_PER_MINUTE,
            120,
            1,
            100_000,
            "RATE_LIMIT_USER_DATA_PER_MINUTE",
          ),
          windowMs: 60_000,
        },
      },
    }),
    eventLogger: logger,
    readinessCheck: async () => ({
      database: (await store.isHealthy()) ? "ok" : "error",
      staticFiles: "ok",
    }),
    ...(webJsKey
      ? {
          webMapConfig: {
            providerId: "amap-jsapi" as const,
            key: webJsKey,
            serviceHost: "/_AMapService" as const,
          },
        }
      : {}),
    legalConfig: {
      operatorName: required(
        environment.ZHAOLU_OPERATOR_NAME,
        "ZHAOLU_OPERATOR_NAME",
      ),
      privacyContact: required(
        environment.ZHAOLU_PRIVACY_CONTACT,
        "ZHAOLU_PRIVACY_CONTACT",
      ),
      logRetentionDays: integer(
        environment.ZHAOLU_LOG_RETENTION_DAYS,
        30,
        1,
        365,
        "ZHAOLU_LOG_RETENTION_DAYS",
      ),
    },
  });
  return {
    api,
    hasWebMap: Boolean(webJsKey),
    ...(securityCode ? { securityCode } : {}),
  };
}

function runtimeFor(environment: CloudflareEnvironment): Runtime {
  const key = environment.DB as object;
  const existing = runtimes.get(key);
  if (existing) return existing;
  const runtime = createRuntime(environment);
  runtimes.set(key, runtime);
  return runtime;
}

function clientRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  const clientKey =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  headers.set("x-zhaolu-client-key", clientKey);
  return new Request(request, { headers });
}

function secureAssetResponse(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", contentSecurityPolicy);
  headers.set("permissions-policy", "camera=(), geolocation=(self), microphone=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (url.protocol === "https:") {
    headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function configurationError(): Response {
  return Response.json(
    {
      schemaVersion: "1",
      error: { code: "RUNTIME_CONFIGURATION_ERROR", retryable: false },
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

async function fetchWorker(
  request: Request,
  environment: CloudflareEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_AMapService/")
  ) {
    let runtime: Runtime;
    try {
      runtime = runtimeFor(environment);
    } catch {
      return configurationError();
    }
    if (url.pathname.startsWith("/api/")) {
      return runtime.api(clientRequest(request));
    }
    if (!runtime.hasWebMap || !runtime.securityCode) {
      return new Response(null, { status: 404 });
    }
    return proxyAmapJsApiRequest(request, {
      securityCode: runtime.securityCode,
      publicOrigin: url.origin,
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  const asset = await environment.ASSETS.fetch(request);
  return secureAssetResponse(asset, url);
}

export default {
  fetch(
    request: Request,
    environment: CloudflareEnvironment,
    _context: WorkerExecutionContextBinding,
  ): Promise<Response> {
    return fetchWorker(request, environment);
  },
  scheduled(
    _controller: unknown,
    environment: CloudflareEnvironment,
    context: WorkerExecutionContextBinding,
  ): void {
    const store = new D1UserDataStore(environment.DB);
    context.waitUntil(store.purgeExpired(Date.now()));
  },
};
