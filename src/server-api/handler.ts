import {
  RouteRecommendationError,
  type RouteRecommendationErrorCode,
} from "../route-recommendation/errors.ts";
import type {
  FindScenicRoutesRequest,
  FindScenicRoutesResult,
} from "../route-recommendation/models.ts";
import {
  SERVER_API_SCHEMA_VERSION,
  type ServerApiErrorResponse,
} from "./contracts.ts";
import type { RouteDeliveryPolicyResolver } from "../route-delivery/policy.ts";
import type { RouteDeliveryCapabilities } from "../route-delivery/ports.ts";
import type {
  ApiRateLimiter,
  ApiRateLimitScope,
} from "../runtime/rateLimit.ts";
import {
  UserDataError,
  UserDataService,
} from "../user-data/service.ts";
import {
  mapFindScenicRoutesResult,
  mapPlanRoutesApiRequest,
} from "./mappers.ts";
import { SERVER_API_OPENAPI_DOCUMENT } from "./openapi.ts";

export const MAX_SERVER_API_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_ROUTE_DELIVERY_CAPABILITIES: RouteDeliveryCapabilities =
  Object.freeze({
    exportFormats: Object.freeze(["geojson", "gpx"]),
    navigationTargets: Object.freeze(["amap"]),
  });

export type PlanScenicRoutes = (
  request: FindScenicRoutesRequest,
  signal?: AbortSignal,
) => Promise<FindScenicRoutesResult>;

export type ServerApiHandler = (
  request: Request,
) => Promise<Response>;

export type CreateServerApiOptions = Readonly<{
  planRoutes: PlanScenicRoutes;
  timeoutMs?: number;
  requestIdFactory?: () => string;
  deliveryPolicyResolver?: RouteDeliveryPolicyResolver;
  deliveryCapabilities?: RouteDeliveryCapabilities;
  userData?: UserDataService;
  rateLimiter?: ApiRateLimiter;
  readinessCheck?: () => Promise<
    Readonly<Record<string, "ok" | "error">>
  >;
}>;

class ApiTransportError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    retryable = false,
  ) {
    super(code);
    this.name = "ApiTransportError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function responseHeaders(requestId: string): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "permissions-policy":
      "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-request-id": requestId,
  });
}

function jsonResponse(
  payload: unknown,
  status: number,
  requestId: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = responseHeaders(requestId);
  Object.entries(extraHeaders ?? {}).forEach(([name, value]) => {
    headers.set(name, value);
  });
  return new Response(JSON.stringify(payload), { status, headers });
}

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  retryable: boolean,
  details?: Readonly<Record<string, string | number | boolean>>,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const payload: ServerApiErrorResponse = {
    schemaVersion: SERVER_API_SCHEMA_VERSION,
    requestId,
    error: {
      code,
      retryable,
      ...(details ? { details } : {}),
    },
  };
  return jsonResponse(payload, status, requestId, extraHeaders);
}

function routeErrorStatus(code: RouteRecommendationErrorCode): number {
  switch (code) {
    case "INVALID_REQUEST":
      return 400;
    case "PLACE_NOT_FOUND":
      return 404;
    case "ROUTE_PROVIDER_QUOTA_EXCEEDED":
      return 429;
    case "NO_SUITABLE_ROUTE":
      return 422;
    case "REQUEST_ABORTED":
      return 408;
    case "ROUTE_PROVIDER_TIMEOUT":
      return 504;
    case "PLACE_PROVIDER_UNAVAILABLE":
    case "SCENERY_PROVIDER_UNAVAILABLE":
      return 503;
    case "CONFIGURATION_ERROR":
    case "INTERNAL_ERROR":
      return 500;
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiTransportError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }
  const declaredLength = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_SERVER_API_BODY_BYTES
  ) {
    throw new ApiTransportError(413, "PAYLOAD_TOO_LARGE");
  }
  if (request.body === null) {
    throw new ApiTransportError(400, "INVALID_JSON");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.byteLength;
    if (totalLength > MAX_SERVER_API_BODY_BYTES) {
      await reader.cancel();
      throw new ApiTransportError(413, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ApiTransportError(400, "INVALID_JSON");
  }
}

function fallbackRequestId(
  request: Request,
  factory: () => string,
): string {
  const requested = request.headers.get("x-request-id")?.trim();
  if (
    requested &&
    requested.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(requested)
  ) {
    return requested;
  }
  return factory();
}

function healthPayload() {
  return {
    schemaVersion: SERVER_API_SCHEMA_VERSION,
    service: "zhaolu-route-finder",
    status: "ok",
  } as const;
}

function rateLimitScope(
  pathname: string,
): ApiRateLimitScope | null {
  if (pathname === "/api/v1/routes/plan") return "plan";
  if (pathname === "/api/v1/session") return "session";
  if (pathname.startsWith("/api/v1/saved-routes")) {
    return "user-data";
  }
  return null;
}

function capabilitiesPayload(
  userDataAvailable: boolean,
  deliveryCapabilities: RouteDeliveryCapabilities,
) {
  return {
    schemaVersion: SERVER_API_SCHEMA_VERSION,
    apiVersion: "v1",
    modes: ["running", "cycling"],
    coordinateReferenceSystem: "WGS84",
    geometryFormat: "GeoJSON",
    limits: {
      targetDistanceMeters: { minimum: 500, maximum: 200_000 },
      requiredStops: { maximum: 3 },
      maxResults: { minimum: 1, maximum: 5 },
      requestBodyBytes: { maximum: MAX_SERVER_API_BODY_BYTES },
    },
    scenicFeatures: {
      available: [
        "greenCoverage",
        "waterfrontProximity",
        "builtUpExposure",
      ],
      currentlyUnavailable: ["roadComfort"],
    },
    openApiDocument: "/api/v1/openapi.json",
    routeDelivery: {
      exportFormats: deliveryCapabilities.exportFormats,
      navigationTargets: deliveryCapabilities.navigationTargets,
      savedRoutes: userDataAvailable,
      fieldReports: userDataAvailable,
      authentication: userDataAvailable
        ? "anonymous-bearer-session"
        : "unavailable",
    },
  } as const;
}

async function executePlan(
  planRoutes: PlanScenicRoutes,
  planRequest: FindScenicRoutesRequest,
  callerSignal: AbortSignal,
  timeoutMs: number,
): Promise<FindScenicRoutesResult> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (callerSignal.aborted) {
    abortFromCaller();
  } else {
    callerSignal.addEventListener("abort", abortFromCaller, {
      once: true,
    });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("SERVER_API_TIMEOUT"));
  }, timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    if (controller.signal.aborted) {
      reject(controller.signal.reason);
      return;
    }
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason),
      { once: true },
    );
  });

  try {
    return await Promise.race([
      planRoutes(planRequest, controller.signal),
      aborted,
    ]);
  } catch (error) {
    if (timedOut) {
      throw new ApiTransportError(504, "REQUEST_TIMEOUT", true);
    }
    if (callerSignal.aborted) {
      throw new ApiTransportError(408, "REQUEST_ABORTED");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal.removeEventListener("abort", abortFromCaller);
  }
}

export function createServerApi(
  options: CreateServerApiOptions,
): ServerApiHandler {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("SERVER_API_TIMEOUT_INVALID");
  }
  const requestIdFactory =
    options.requestIdFactory ?? (() => crypto.randomUUID());

  return async (request) => {
    let requestId = fallbackRequestId(request, requestIdFactory);
    const pathname = new URL(request.url).pathname;
    const scope = rateLimitScope(pathname);
    if (scope && options.rateLimiter) {
      const result = options.rateLimiter.consume(
        request.headers.get("x-zhaolu-client-key") ?? "unknown",
        scope,
      );
      if (!result.allowed) {
        return errorResponse(
          requestId,
          429,
          "RATE_LIMITED",
          true,
          undefined,
          {
            "retry-after": String(result.retryAfterSeconds),
            "x-rate-limit-remaining": "0",
          },
        );
      }
    }

    if (pathname === "/api/v1/health") {
      if (request.method !== "GET") {
        return errorResponse(
          requestId,
          405,
          "METHOD_NOT_ALLOWED",
          false,
          undefined,
          { allow: "GET" },
        );
      }
      return jsonResponse(healthPayload(), 200, requestId);
    }

    if (pathname === "/api/v1/ready") {
      if (request.method !== "GET") {
        return errorResponse(
          requestId,
          405,
          "METHOD_NOT_ALLOWED",
          false,
          undefined,
          { allow: "GET" },
        );
      }
      let checks: Readonly<Record<string, "ok" | "error">>;
      try {
        checks = options.readinessCheck
          ? await options.readinessCheck()
          : { api: "ok" };
      } catch {
        checks = { runtime: "error" };
      }
      const ready = Object.values(checks).every(
        (status) => status === "ok",
      );
      return jsonResponse(
        {
          schemaVersion: SERVER_API_SCHEMA_VERSION,
          service: "zhaolu-route-finder",
          status: ready ? "ready" : "not-ready",
          checks,
        },
        ready ? 200 : 503,
        requestId,
      );
    }

    if (pathname === "/api/v1/capabilities") {
      if (request.method !== "GET") {
        return errorResponse(
          requestId,
          405,
          "METHOD_NOT_ALLOWED",
          false,
          undefined,
          { allow: "GET" },
        );
      }
      return jsonResponse(
        capabilitiesPayload(
          options.userData !== undefined,
          options.deliveryCapabilities ??
            DEFAULT_ROUTE_DELIVERY_CAPABILITIES,
        ),
        200,
        requestId,
      );
    }

    if (pathname === "/api/v1/openapi.json") {
      if (request.method !== "GET") {
        return errorResponse(
          requestId,
          405,
          "METHOD_NOT_ALLOWED",
          false,
          undefined,
          { allow: "GET" },
        );
      }
      return jsonResponse(
        SERVER_API_OPENAPI_DOCUMENT,
        200,
        requestId,
      );
    }

    const savedRouteMatch =
      /^\/api\/v1\/saved-routes\/([0-9a-f-]{36})$/.exec(
        pathname,
      );
    const feedbackMatch =
      /^\/api\/v1\/saved-routes\/([0-9a-f-]{36})\/feedback$/.exec(
        pathname,
      );
    if (
      pathname === "/api/v1/session" ||
      pathname === "/api/v1/saved-routes" ||
      savedRouteMatch ||
      feedbackMatch
    ) {
      if (!options.userData) {
        return errorResponse(
          requestId,
          503,
          "USER_DATA_UNAVAILABLE",
          false,
        );
      }
      try {
        if (pathname === "/api/v1/session") {
          if (request.method !== "POST") {
            return errorResponse(
              requestId,
              405,
              "METHOD_NOT_ALLOWED",
              false,
              undefined,
              { allow: "POST" },
            );
          }
          return jsonResponse(
            {
              schemaVersion: SERVER_API_SCHEMA_VERSION,
              requestId,
              session: options.userData.issueSession(),
            },
            201,
            requestId,
          );
        }

        const userId = options.userData.authenticate(request);
        if (pathname === "/api/v1/saved-routes") {
          if (request.method === "GET") {
            return jsonResponse(
              {
                schemaVersion: SERVER_API_SCHEMA_VERSION,
                requestId,
                routes: options.userData.listSavedRoutes(userId),
              },
              200,
              requestId,
            );
          }
          if (request.method === "POST") {
            const body = await readJsonBody(request);
            return jsonResponse(
              {
                schemaVersion: SERVER_API_SCHEMA_VERSION,
                requestId,
                route: options.userData.saveRoute(userId, body),
              },
              201,
              requestId,
            );
          }
          return errorResponse(
            requestId,
            405,
            "METHOD_NOT_ALLOWED",
            false,
            undefined,
            { allow: "GET, POST" },
          );
        }

        if (savedRouteMatch) {
          if (request.method !== "DELETE") {
            return errorResponse(
              requestId,
              405,
              "METHOD_NOT_ALLOWED",
              false,
              undefined,
              { allow: "DELETE" },
            );
          }
          options.userData.deleteSavedRoute(
            userId,
            savedRouteMatch[1],
          );
          return jsonResponse(
            {
              schemaVersion: SERVER_API_SCHEMA_VERSION,
              requestId,
              deleted: true,
            },
            200,
            requestId,
          );
        }

        if (feedbackMatch) {
          if (request.method !== "POST") {
            return errorResponse(
              requestId,
              405,
              "METHOD_NOT_ALLOWED",
              false,
              undefined,
              { allow: "POST" },
            );
          }
          const body = await readJsonBody(request);
          return jsonResponse(
            {
              schemaVersion: SERVER_API_SCHEMA_VERSION,
              requestId,
              report: options.userData.addFieldReport(
                userId,
                feedbackMatch[1],
                body,
              ),
            },
            201,
            requestId,
          );
        }
      } catch (error) {
        if (error instanceof UserDataError) {
          return errorResponse(
            requestId,
            error.status,
            error.code,
            false,
            error.field ? { field: error.field } : undefined,
            error.status === 401
              ? { "www-authenticate": "Bearer" }
              : undefined,
          );
        }
        return errorResponse(
          requestId,
          500,
          "INTERNAL_ERROR",
          false,
        );
      }
    }

    if (pathname !== "/api/v1/routes/plan") {
      return errorResponse(
        requestId,
        404,
        "ENDPOINT_NOT_FOUND",
        false,
      );
    }
    if (request.method !== "POST") {
      return errorResponse(
        requestId,
        405,
        "METHOD_NOT_ALLOWED",
        false,
        undefined,
        { allow: "POST" },
      );
    }

    try {
      const body = await readJsonBody(request);
      const planRequest = mapPlanRoutesApiRequest(body, requestId);
      requestId = planRequest.requestId;
      const result = await executePlan(
        options.planRoutes,
        planRequest,
        request.signal,
        timeoutMs,
      );
      return jsonResponse(
        mapFindScenicRoutesResult(
          result,
          options.deliveryPolicyResolver,
        ),
        200,
        requestId,
      );
    } catch (error) {
      if (error instanceof ApiTransportError) {
        return errorResponse(
          requestId,
          error.status,
          error.code,
          error.retryable,
        );
      }
      if (error instanceof RouteRecommendationError) {
        return errorResponse(
          requestId,
          routeErrorStatus(error.code),
          error.code,
          error.retryable,
          error.details,
        );
      }
      return errorResponse(
        requestId,
        500,
        "INTERNAL_ERROR",
        false,
      );
    }
  };
}
