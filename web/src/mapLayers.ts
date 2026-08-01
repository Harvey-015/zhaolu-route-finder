export type MapLayerKind = "base" | "reference";

export type MapLayerCoordinateSystem =
  | "WGS84"
  | "GCJ02"
  | "provider-native";

export type MapLayerProvider<Context, Layer> = Readonly<{
  id: string;
  displayName: string;
  kind: MapLayerKind;
  attribution: string;
  coordinateSystem: MapLayerCoordinateSystem;
  defaultEnabled?: boolean;
  createLayers: (context: Context) => readonly Layer[];
}>;

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function defineMapLayerProvider<Context, Layer>(
  provider: MapLayerProvider<Context, Layer>,
): MapLayerProvider<Context, Layer> {
  if (!EXTENSION_ID_PATTERN.test(provider.id)) {
    throw new TypeError("MAP_LAYER_PROVIDER_ID_INVALID");
  }
  if (!provider.displayName.trim()) {
    throw new TypeError("MAP_LAYER_PROVIDER_NAME_REQUIRED");
  }
  if (!provider.attribution.trim()) {
    throw new TypeError("MAP_LAYER_PROVIDER_ATTRIBUTION_REQUIRED");
  }
  if (provider.kind === "base" && provider.defaultEnabled !== undefined) {
    throw new TypeError("BASE_LAYER_DEFAULT_ENABLED_NOT_ALLOWED");
  }
  return Object.freeze({ ...provider });
}

export class MapLayerProviderRegistry<Context, Layer> {
  private readonly registered: ReadonlyMap<
    string,
    MapLayerProvider<Context, Layer>
  >;

  constructor(
    providers: readonly MapLayerProvider<Context, Layer>[],
  ) {
    const registered = new Map<
      string,
      MapLayerProvider<Context, Layer>
    >();
    for (const provider of providers) {
      const normalized = defineMapLayerProvider(provider);
      if (registered.has(normalized.id)) {
        throw new TypeError("MAP_LAYER_PROVIDER_DUPLICATE");
      }
      registered.set(normalized.id, normalized);
    }
    this.registered = registered;
  }

  get(id: string): MapLayerProvider<Context, Layer> | undefined {
    return this.registered.get(id);
  }

  require(id: string): MapLayerProvider<Context, Layer> {
    const provider = this.get(id);
    if (!provider) {
      throw new Error("MAP_LAYER_PROVIDER_NOT_REGISTERED");
    }
    return provider;
  }

  providers(
    kind?: MapLayerKind,
  ): readonly MapLayerProvider<Context, Layer>[] {
    const providers = [...this.registered.values()];
    return kind === undefined
      ? providers
      : providers.filter((provider) => provider.kind === kind);
  }

  ids(kind?: MapLayerKind): readonly string[] {
    return this.providers(kind).map(({ id }) => id);
  }
}
