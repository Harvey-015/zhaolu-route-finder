import {
  LEGAL_DOCUMENT_VERSION,
  type LegalDocumentConfig,
} from "../../src/legal/config.ts";
import {
  RouteApiError,
  type RouteApiFetch,
} from "./api.ts";

export { LEGAL_DOCUMENT_VERSION };

export type PublicLegalConfig = LegalDocumentConfig &
  Readonly<{
    documentVersion: string;
  }>;

export async function loadLegalConfig(
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<PublicLegalConfig> {
  let response: Response;
  try {
    response = await fetcher("/api/v1/legal-config", {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new RouteApiError("NETWORK_ERROR", 0, true);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      response.status,
      false,
    );
  }
  if (
    !response.ok ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      response.status,
      false,
    );
  }
  const config = value as Record<string, unknown>;
  if (
    config.configured !== true ||
    typeof config.documentVersion !== "string" ||
    config.documentVersion !== LEGAL_DOCUMENT_VERSION ||
    typeof config.operatorName !== "string" ||
    !config.operatorName.trim() ||
    typeof config.privacyContact !== "string" ||
    !config.privacyContact.trim() ||
    typeof config.logRetentionDays !== "number" ||
    !Number.isInteger(config.logRetentionDays) ||
    config.logRetentionDays < 1 ||
    config.logRetentionDays > 365
  ) {
    throw new RouteApiError(
      "LEGAL_CONFIG_UNAVAILABLE",
      response.status,
      false,
    );
  }
  return config as PublicLegalConfig;
}
