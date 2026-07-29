export type RouteRecommendationErrorCode =
  | "INVALID_REQUEST"
  | "PLACE_NOT_FOUND"
  | "PLACE_PROVIDER_UNAVAILABLE"
  | "ROUTE_PROVIDER_TIMEOUT"
  | "ROUTE_PROVIDER_QUOTA_EXCEEDED"
  | "SCENERY_PROVIDER_UNAVAILABLE"
  | "NO_SUITABLE_ROUTE"
  | "REQUEST_ABORTED"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

export class RouteRecommendationError extends Error {
  readonly code: RouteRecommendationErrorCode;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, string | number | boolean>>;

  constructor({
    code,
    retryable = false,
    details,
    cause,
  }: {
    code: RouteRecommendationErrorCode;
    retryable?: boolean;
    details?: Readonly<Record<string, string | number | boolean>>;
    cause?: unknown;
  }) {
    super(code, { cause });
    this.name = "RouteRecommendationError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export type ProviderErrorCode =
  | "NOT_FOUND"
  | "TIMEOUT"
  | "QUOTA_EXCEEDED"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "ABORTED";

export class ProviderError extends Error {
  readonly providerId: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor({
    providerId,
    code,
    message,
    retryable = code === "TIMEOUT" || code === "UNAVAILABLE",
    cause,
  }: {
    providerId: string;
    code: ProviderErrorCode;
    message: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(message, { cause });
    this.name = "ProviderError";
    this.providerId = providerId;
    this.code = code;
    this.retryable = retryable;
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new RouteRecommendationError({
    code: "REQUEST_ABORTED",
  });
}
