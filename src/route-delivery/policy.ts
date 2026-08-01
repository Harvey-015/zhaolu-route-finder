export type RouteExportFormat = string;
export type NavigationTarget = string;

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

export type RouteDeliveryPolicyResolverOptions = Readonly<{
  amapRouteExportsAllowed?: boolean;
}>;

function amapPolicy(
  exportsAllowed: boolean,
): RouteDeliveryPolicy {
  return Object.freeze({
    policyId: "amap-web-service-delivery",
    policyVersion: exportsAllowed
      ? "2026-08-01-authorized-export"
      : "2026-08-01-safe-default",
    exportFormats: exportsAllowed
      ? (["geojson", "gpx"] as const)
      : [],
    navigationTargets: ["amap"] as const,
    persistence: "metadata-only",
    expiresAfterSeconds: 24 * 60 * 60,
  });
}

const FIXTURE_POLICY: RouteDeliveryPolicy = Object.freeze({
  policyId: "fixture-route-delivery",
  policyVersion: "1",
  exportFormats: ["geojson", "gpx"] as const,
  navigationTargets: ["amap"] as const,
  persistence: "allowed",
  expiresAfterSeconds: 30 * 24 * 60 * 60,
});

export function createRouteDeliveryPolicyResolver(
  options: RouteDeliveryPolicyResolverOptions = {},
): RouteDeliveryPolicyResolver {
  const resolvedAmapPolicy = amapPolicy(
    options.amapRouteExportsAllowed === true,
  );
  return (providerId) =>
    providerId === "amap-route"
      ? resolvedAmapPolicy
      : DENY_BY_DEFAULT;
}

export const resolveRouteDeliveryPolicy =
  createRouteDeliveryPolicyResolver();

export const resolveFixtureRouteDeliveryPolicy: RouteDeliveryPolicyResolver =
  (providerId) =>
    providerId === "fake-route"
      ? FIXTURE_POLICY
      : resolveRouteDeliveryPolicy(providerId);
