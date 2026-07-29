import {
  ProviderError,
  type ProviderErrorCode,
} from "../../route-recommendation/errors.ts";

const MESSAGE_BY_CODE: Readonly<Record<ProviderErrorCode, string>> = {
  NOT_FOUND: "WORLDCOVER_DATA_NOT_FOUND",
  TIMEOUT: "WORLDCOVER_REQUEST_TIMEOUT",
  QUOTA_EXCEEDED: "WORLDCOVER_QUOTA_EXCEEDED",
  UNAVAILABLE: "WORLDCOVER_SERVICE_UNAVAILABLE",
  INVALID_RESPONSE: "WORLDCOVER_INVALID_RESPONSE",
  ABORTED: "WORLDCOVER_REQUEST_ABORTED",
};

export function worldCoverProviderError(
  providerId: string,
  code: ProviderErrorCode,
  cause?: unknown,
): ProviderError {
  return new ProviderError({
    providerId,
    code,
    message: MESSAGE_BY_CODE[code],
    retryable: code === "TIMEOUT" || code === "UNAVAILABLE",
    cause,
  });
}
