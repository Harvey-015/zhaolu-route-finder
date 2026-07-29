export type RouteExportFormat = "geojson" | "gpx";
export type NavigationTarget = "amap";

export type RouteDeliveryPolicy = Readonly<{
  policyId: string;
  policyVersion: string;
  exportFormats: readonly RouteExportFormat[];
  navigationTargets: readonly NavigationTarget[];
  persistence: "allowed" | "metadata-only" | "denied";
  expiresAfterSeconds: number;
}>;

export type RouteDeliveryPolicyResolver = (
  providerId: string,
) => RouteDeliveryPolicy;

const DENY_BY_DEFAULT: RouteDeliveryPolicy = Object.freeze({
  policyId: "unknown-provider-deny",
  policyVersion: "1",
  exportFormats: [],
  navigationTargets: [],
  persistence: "denied",
  expiresAfterSeconds: 0,
});

const AMAP_POLICY: RouteDeliveryPolicy = Object.freeze({
  policyId: "amap-web-service-delivery",
  policyVersion: "2026-07-29",
  exportFormats: ["geojson", "gpx"] as const,
  navigationTargets: ["amap"] as const,
  persistence: "metadata-only",
  expiresAfterSeconds: 24 * 60 * 60,
});

const FIXTURE_POLICY: RouteDeliveryPolicy = Object.freeze({
  policyId: "fixture-route-delivery",
  policyVersion: "1",
  exportFormats: ["geojson", "gpx"] as const,
  navigationTargets: ["amap"] as const,
  persistence: "allowed",
  expiresAfterSeconds: 30 * 24 * 60 * 60,
});

export const resolveRouteDeliveryPolicy: RouteDeliveryPolicyResolver =
  (providerId) =>
    providerId === "amap-route" ? AMAP_POLICY : DENY_BY_DEFAULT;

export const resolveFixtureRouteDeliveryPolicy: RouteDeliveryPolicyResolver =
  (providerId) =>
    providerId === "fake-route"
      ? FIXTURE_POLICY
      : resolveRouteDeliveryPolicy(providerId);
