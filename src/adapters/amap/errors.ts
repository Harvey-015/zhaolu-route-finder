import { ProviderError } from "../../route-recommendation/errors.ts";

const QUOTA_INFO_CODES = new Set([
  "10003",
  "10004",
  "10010",
  "10014",
  "10015",
  "10019",
  "10020",
  "10021",
  "10029",
  "10044",
  "10045",
  "40000",
  "40003",
]);

const NO_ROUTE_INFO_CODES = new Set([
  "20011",
  "20800",
  "20801",
  "20802",
  "20803",
]);

const RETRYABLE_INFO_CODES = new Set([
  "10016",
  "10017",
  "20003",
]);

export function amapApiFailure(
  providerId: string,
  infoCode: string,
): ProviderError {
  if (QUOTA_INFO_CODES.has(infoCode)) {
    return new ProviderError({
      providerId,
      code: "QUOTA_EXCEEDED",
      message: "AMAP_QUOTA_EXCEEDED",
      retryable: false,
    });
  }
  if (NO_ROUTE_INFO_CODES.has(infoCode)) {
    return new ProviderError({
      providerId,
      code: "NOT_FOUND",
      message: "AMAP_RESULT_NOT_FOUND",
      retryable: false,
    });
  }
  if (
    RETRYABLE_INFO_CODES.has(infoCode) ||
    infoCode.startsWith("3")
  ) {
    return new ProviderError({
      providerId,
      code: "UNAVAILABLE",
      message: "AMAP_SERVICE_UNAVAILABLE",
      retryable: true,
    });
  }
  return new ProviderError({
    providerId,
    code: "UNAVAILABLE",
    message: "AMAP_REQUEST_REJECTED",
    retryable: false,
  });
}

export function invalidAmapResponse(providerId: string): ProviderError {
  return new ProviderError({
    providerId,
    code: "INVALID_RESPONSE",
    message: "AMAP_INVALID_RESPONSE",
    retryable: false,
  });
}
