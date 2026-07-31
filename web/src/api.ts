import type {
  PlanRoutesApiRequest,
  PlanRoutesApiResponse,
  ServerApiErrorResponse,
} from "../../src/server-api/contracts.ts";

export type RouteApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class RouteApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Readonly<
    Record<string, string | number | boolean>
  >;

  constructor(
    code: string,
    status: number,
    retryable: boolean,
    details?: Readonly<
      Record<string, string | number | boolean>
    >,
  ) {
    super(code);
    this.name = "RouteApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPlanResponse(
  value: unknown,
): value is PlanRoutesApiResponse {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === "1" &&
    typeof value.requestId === "string" &&
    (value.status === "complete" || value.status === "partial") &&
    Array.isArray(value.routes) &&
    Array.isArray(value.warnings) &&
    isRecord(value.diagnostics)
  );
}

function apiErrorBody(
  value: unknown,
): ServerApiErrorResponse | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  if (
    value.schemaVersion !== "1" ||
    typeof value.requestId !== "string" ||
    typeof value.error.code !== "string" ||
    typeof value.error.retryable !== "boolean"
  ) {
    return null;
  }
  return value as ServerApiErrorResponse;
}

export async function planRoutes(
  request: PlanRoutesApiRequest,
  signal?: AbortSignal,
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<PlanRoutesApiResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/routes/plan", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-request-id": request.requestId ?? "",
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new RouteApiError("NETWORK_ERROR", 0, true);
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      response.status,
      false,
    );
  }

  if (!response.ok) {
    const apiError = apiErrorBody(payload);
    throw new RouteApiError(
      apiError?.error.code ?? "API_REQUEST_FAILED",
      response.status,
      apiError?.error.retryable ?? response.status >= 500,
      apiError?.error.details,
    );
  }
  if (!isPlanResponse(payload)) {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      response.status,
      false,
    );
  }
  return payload;
}
