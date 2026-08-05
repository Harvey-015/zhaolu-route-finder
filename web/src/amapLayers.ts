import {
  defineMapLayerProvider,
  MapLayerProviderRegistry,
  type MapLayerProvider,
} from "./mapLayers.ts";

export type AmapLayer = Readonly<Record<string, unknown>>;

export type AmapOverlay = Readonly<{
  on?: (event: string, callback: () => void) => void;
}>;

export type AmapMap = Readonly<{
  add(overlays: AmapOverlay | readonly AmapOverlay[]): void;
  remove(overlays: readonly AmapOverlay[]): void;
  setLayers(layers: readonly AmapLayer[]): void;
  setFitView(
    overlays?: readonly AmapOverlay[],
    immediately?: boolean,
    avoid?: readonly number[],
  ): void;
  destroy(): void;
}>;

type AmapTileLayerConstructor = {
  new (
    options?: Readonly<Record<string, unknown>>,
  ): AmapLayer;
  readonly Satellite: new (
    options?: Readonly<Record<string, unknown>>,
  ) => AmapLayer;
  readonly RoadNet: new (
    options?: Readonly<Record<string, unknown>>,
  ) => AmapLayer;
};

export type AmapNamespace = Readonly<{
  Map: new (
    container: HTMLDivElement,
    options: Readonly<Record<string, unknown>>,
  ) => AmapMap;
  Polyline: new (
    options: Readonly<Record<string, unknown>>,
  ) => AmapOverlay;
  CircleMarker: new (
    options: Readonly<Record<string, unknown>>,
  ) => AmapOverlay;
  Text: new (
    options: Readonly<Record<string, unknown>>,
  ) => AmapOverlay;
  TileLayer: AmapTileLayerConstructor;
}>;

export type AmapMapLayerContext = Readonly<{
  AMap: AmapNamespace;
}>;

export type AmapMapLayerProvider = MapLayerProvider<
  AmapMapLayerContext,
  AmapLayer
>;

export const amapSatelliteLayerProvider =
  defineMapLayerProvider<AmapMapLayerContext, AmapLayer>({
    id: "amap-satellite",
    displayName: "卫星图",
    kind: "base",
    attribution: "高德地图",
    coordinateSystem: "GCJ02",
    createLayers: ({ AMap }) => [
      new AMap.TileLayer.Satellite(),
      new AMap.TileLayer.RoadNet(),
    ],
  });

export const amapStandardLayerProvider =
  defineMapLayerProvider<AmapMapLayerContext, AmapLayer>({
    id: "amap-standard",
    displayName: "标准图",
    kind: "base",
    attribution: "高德地图",
    coordinateSystem: "GCJ02",
    createLayers: ({ AMap }) => [new AMap.TileLayer()],
  });

export const defaultAmapMapLayerRegistry =
  new MapLayerProviderRegistry<AmapMapLayerContext, AmapLayer>([
    amapSatelliteLayerProvider,
    amapStandardLayerProvider,
  ]);
