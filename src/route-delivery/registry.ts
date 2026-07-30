import type {
  NavigationLinkProvider,
  RouteDeliveryCapabilities,
  RouteExporter,
} from "./ports.ts";

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function validateExtension(
  id: string,
  label: string,
  kind: "exporter" | "navigation",
): void {
  if (!EXTENSION_ID_PATTERN.test(id)) {
    throw new TypeError(
      kind === "exporter"
        ? "ROUTE_EXPORTER_FORMAT_INVALID"
        : "NAVIGATION_PROVIDER_TARGET_INVALID",
    );
  }
  if (!label.trim()) {
    throw new TypeError(
      kind === "exporter"
        ? "ROUTE_EXPORTER_LABEL_REQUIRED"
        : "NAVIGATION_PROVIDER_LABEL_REQUIRED",
    );
  }
}

export class RouteDeliveryRegistry {
  private readonly exportersByFormat: ReadonlyMap<
    string,
    RouteExporter
  >;
  private readonly navigationByTarget: ReadonlyMap<
    string,
    NavigationLinkProvider
  >;

  constructor(options: Readonly<{
    exporters?: readonly RouteExporter[];
    navigationLinkProviders?: readonly NavigationLinkProvider[];
  }> = {}) {
    const exporters = new Map<string, RouteExporter>();
    for (const exporter of options.exporters ?? []) {
      validateExtension(exporter.format, exporter.label, "exporter");
      if (exporters.has(exporter.format)) {
        throw new TypeError("ROUTE_EXPORTER_DUPLICATE");
      }
      exporters.set(exporter.format, Object.freeze(exporter));
    }

    const navigationProviders = new Map<
      string,
      NavigationLinkProvider
    >();
    for (const provider of options.navigationLinkProviders ?? []) {
      validateExtension(
        provider.target,
        provider.label,
        "navigation",
      );
      if (navigationProviders.has(provider.target)) {
        throw new TypeError("NAVIGATION_PROVIDER_DUPLICATE");
      }
      navigationProviders.set(
        provider.target,
        Object.freeze(provider),
      );
    }

    this.exportersByFormat = exporters;
    this.navigationByTarget = navigationProviders;
  }

  exporter(format: string): RouteExporter | undefined {
    return this.exportersByFormat.get(format);
  }

  navigationLinkProvider(
    target: string,
  ): NavigationLinkProvider | undefined {
    return this.navigationByTarget.get(target);
  }

  exporters(formats: readonly string[]): readonly RouteExporter[] {
    return formats.flatMap((format) => {
      const exporter = this.exporter(format);
      return exporter ? [exporter] : [];
    });
  }

  navigationLinkProviders(
    targets: readonly string[],
  ): readonly NavigationLinkProvider[] {
    return targets.flatMap((target) => {
      const provider = this.navigationLinkProvider(target);
      return provider ? [provider] : [];
    });
  }

  capabilities(): RouteDeliveryCapabilities {
    return {
      exportFormats: [...this.exportersByFormat.keys()],
      navigationTargets: [...this.navigationByTarget.keys()],
    };
  }
}
