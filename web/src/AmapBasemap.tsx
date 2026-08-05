import { useEffect, useMemo, useRef, useState } from "react";
import { wgs84ToGcj02 } from "../../src/adapters/amap/coordinates.ts";
import { wgs84Point } from "../../src/route-recommendation/coordinates.ts";
import type {
  ApiPlace,
  ApiRecommendedRoute,
} from "../../src/server-api/contracts.ts";
import {
  defineBasemapRenderer,
  type BasemapRenderer,
  type BasemapViewportProps,
} from "./basemap.ts";
import { loadWebMapConfig } from "./mapConfig.ts";
import {
  MapLayerProviderRegistry,
} from "./mapLayers.ts";
import {
  defaultAmapMapLayerRegistry,
  type AmapLayer,
  type AmapMap,
  type AmapMapLayerContext,
  type AmapMapLayerProvider,
  type AmapNamespace,
  type AmapOverlay,
} from "./amapLayers.ts";
import { ROUTE_COLORS, routeDisplayName } from "./model.ts";
import { RouteMap } from "./RouteMap.tsx";

declare global {
  interface Window {
    AMap?: AmapNamespace;
    _AMapSecurityConfig?: { serviceHost: string };
    __zhaoluAmapLoading?: Promise<AmapNamespace>;
  }
}

function loadAmapJsApi(
  key: string,
  serviceHost: string,
): Promise<AmapNamespace> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (window.__zhaoluAmapLoading) return window.__zhaoluAmapLoading;

  window._AMapSecurityConfig = {
    serviceHost: new URL(serviceHost, window.location.origin)
      .toString()
      .replace(/\/$/, ""),
  };
  const callbackName = `__zhaoluAmapReady_${crypto.randomUUID().replaceAll("-", "")}`;
  const globals = window as unknown as Record<string, unknown>;

  window.__zhaoluAmapLoading = new Promise<AmapNamespace>(
    (resolve, reject) => {
      const script = document.createElement("script");
      const url = new URL("https://webapi.amap.com/maps");
      url.searchParams.set("v", "2.0");
      url.searchParams.set("key", key);
      url.searchParams.set("callback", callbackName);
      script.src = url.toString();
      script.async = true;
      script.referrerPolicy = "origin";

      const fail = () => {
        delete globals[callbackName];
        window.__zhaoluAmapLoading = undefined;
        reject(new Error("AMAP_JS_API_UNAVAILABLE"));
      };
      globals[callbackName] = () => {
        delete globals[callbackName];
        if (!window.AMap) {
          fail();
          return;
        }
        resolve(window.AMap);
      };
      script.onerror = fail;
      document.head.appendChild(script);
    },
  );
  return window.__zhaoluAmapLoading;
}

export function routeGeometryForAmap(
  route: ApiRecommendedRoute,
): readonly (readonly [number, number])[] {
  return route.geometry.coordinates.map(([longitude, latitude]) => {
    const point = wgs84ToGcj02(wgs84Point(longitude, latitude));
    return [point.longitude, point.latitude] as const;
  });
}

export function placePointForAmap(
  place: ApiPlace,
): readonly [number, number] {
  const [longitude, latitude] = place.point.coordinates;
  const point = wgs84ToGcj02(wgs84Point(longitude, latitude));
  return [point.longitude, point.latitude];
}

function activeLayerProviders(
  registry: MapLayerProviderRegistry<AmapMapLayerContext, AmapLayer>,
  baseLayerId: string,
  referenceLayerIds: ReadonlySet<string>,
): readonly AmapMapLayerProvider[] {
  const baseProvider = registry.require(baseLayerId);
  if (baseProvider.kind !== "base") {
    throw new TypeError("AMAP_BASE_LAYER_PROVIDER_REQUIRED");
  }
  const referenceProviders = [...referenceLayerIds].map((id) => {
    const provider = registry.require(id);
    if (provider.kind !== "reference") {
      throw new TypeError("AMAP_REFERENCE_LAYER_PROVIDER_REQUIRED");
    }
    return provider;
  });
  return [baseProvider, ...referenceProviders];
}

function createActiveLayers(
  AMap: AmapNamespace,
  providers: readonly AmapMapLayerProvider[],
): readonly AmapLayer[] {
  const layers = providers.flatMap((provider) =>
    [...provider.createLayers({ AMap })],
  );
  if (layers.length === 0) {
    throw new TypeError("AMAP_ACTIVE_LAYERS_REQUIRED");
  }
  return layers;
}

function AmapViewport({
  routes,
  start,
  requiredStops,
  selectedRouteId,
  onSelectRoute,
  keyValue,
  serviceHost,
  layerRegistry,
  defaultBaseLayerId,
  defaultReferenceLayerIds,
}: BasemapViewportProps &
  Readonly<{
    keyValue: string;
    serviceHost: string;
    layerRegistry: MapLayerProviderRegistry<
      AmapMapLayerContext,
      AmapLayer
    >;
    defaultBaseLayerId: string;
    defaultReferenceLayerIds: readonly string[];
  }>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AmapMap | null>(null);
  const amapRef = useRef<AmapNamespace | null>(null);
  const overlaysRef = useRef<readonly AmapOverlay[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [baseLayerId, setBaseLayerId] = useState(
    defaultBaseLayerId,
  );
  const [referenceLayerIds, setReferenceLayerIds] = useState<
    ReadonlySet<string>
  >(() => new Set(defaultReferenceLayerIds));
  const baseProviders = layerRegistry.providers("base");
  const referenceProviders = layerRegistry.providers("reference");
  const visibleProviders = useMemo(
    () =>
      activeLayerProviders(
        layerRegistry,
        baseLayerId,
        referenceLayerIds,
      ),
    [baseLayerId, layerRegistry, referenceLayerIds],
  );

  useEffect(() => {
    let active = true;
    void loadAmapJsApi(keyValue, serviceHost)
      .then((AMap) => {
        if (!active || !containerRef.current) return;
        amapRef.current = AMap;
        mapRef.current = new AMap.Map(containerRef.current, {
          layers: createActiveLayers(AMap, visibleProviders),
          zoom: 13,
          viewMode: "2D",
          resizeEnable: true,
        });
        setReady(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      mapRef.current?.destroy();
      mapRef.current = null;
      amapRef.current = null;
      overlaysRef.current = [];
    };
  }, [keyValue, layerRegistry, serviceHost]);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!ready || !AMap || !map) return;
    try {
      map.setLayers(createActiveLayers(AMap, visibleProviders));
    } catch {
      setFailed(true);
    }
  }, [ready, visibleProviders]);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!ready || !AMap || !map || routes.length === 0) return;
    if (overlaysRef.current.length > 0) {
      map.remove(overlaysRef.current);
    }

    const selected =
      routes.find(({ id }) => id === selectedRouteId) ?? routes[0];
    const overlays: AmapOverlay[] = [];
    routes.forEach((route, index) => {
      const isSelected = route.id === selected.id;
      const line = new AMap.Polyline({
        path: routeGeometryForAmap(route),
        strokeColor: ROUTE_COLORS[index % ROUTE_COLORS.length],
        strokeWeight: isSelected ? 9 : 5,
        strokeOpacity: isSelected ? 1 : 0.55,
        lineJoin: "round",
        showDir: isSelected,
        zIndex: isSelected ? 60 : 30,
      });
      line.on?.("click", () => onSelectRoute(route.id));
      overlays.push(line);
    });

    const startPoint = start
      ? placePointForAmap(start)
      : routeGeometryForAmap(selected)[0];
    if (startPoint) {
      overlays.push(
        new AMap.CircleMarker({
          center: startPoint,
          radius: 9,
          strokeColor: "#102e2a",
          strokeWeight: 4,
          fillColor: "#dfff64",
          fillOpacity: 1,
          zIndex: 80,
        }),
      );
    }
    requiredStops.forEach((stop, index) => {
      const position = placePointForAmap(stop);
      overlays.push(
        new AMap.CircleMarker({
          center: position,
          radius: 7,
          strokeColor: "#102e2a",
          strokeWeight: 3,
          fillColor: "#ff8b5b",
          fillOpacity: 1,
          zIndex: 82,
        }),
        new AMap.Text({
          position,
          text: `${index + 1}. ${stop.name}`,
          anchor: "bottom-center",
          offset: [0, -11],
          style: {
            padding: "5px 7px",
            border: "0",
            borderRadius: "4px",
            background: "#fffdf8",
            color: "#102e2a",
            fontSize: "10px",
            fontWeight: "700",
            boxShadow: "0 4px 12px rgba(0,0,0,.16)",
          },
          zIndex: 83,
        }),
      );
    });
    map.add(overlays);
    map.setFitView(overlays, false, [90, 70, 110, 70]);
    overlaysRef.current = overlays;
  }, [
    onSelectRoute,
    ready,
    requiredStops,
    routes,
    selectedRouteId,
    start,
  ]);

  if (failed) {
    return (
      <RouteMap
        onSelectRoute={onSelectRoute}
        requiredStops={requiredStops}
        routes={routes}
        selectedRouteId={selectedRouteId}
        start={start}
      />
    );
  }

  return (
    <div className="route-map-wrap amap-map-wrap">
      <div className="map-caption">
        <div>
          <p className="eyebrow">高德地图</p>
          <strong>真实道路路线对比</strong>
          <span className="map-note">
            {ready
              ? `${visibleProviders[0]?.displayName ?? "地图"} · JS API 2.0`
              : "地图加载中…"}
          </span>
        </div>
      </div>
      <div className="map-layer-controls" aria-label="地图图层">
        <div
          aria-label="底图"
          className="map-base-layer-switch"
          role="group"
        >
          {baseProviders.map((provider) => (
            <button
              aria-pressed={provider.id === baseLayerId}
              className={provider.id === baseLayerId ? "active" : ""}
              key={provider.id}
              onClick={() => setBaseLayerId(provider.id)}
              type="button"
            >
              {provider.displayName}
            </button>
          ))}
        </div>
        {referenceProviders.map((provider) => (
          <label className="map-reference-layer" key={provider.id}>
            <input
              checked={referenceLayerIds.has(provider.id)}
              onChange={(event) => {
                setReferenceLayerIds((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(provider.id);
                  else next.delete(provider.id);
                  return next;
                });
              }}
              type="checkbox"
            />
            {provider.displayName}
          </label>
        ))}
      </div>
      <div
        aria-label="高德路线地图"
        className="amap-map-canvas"
        ref={containerRef}
        role="application"
      />
      <div className="map-legend" aria-label="路线图例">
        {routes.map((route, index) => (
          <button
            className={
              route.id === selectedRouteId
                ? "legend-item active"
                : "legend-item"
            }
            key={route.id}
            onClick={() => onSelectRoute(route.id)}
            type="button"
          >
            <span
              className="legend-swatch"
              style={{
                backgroundColor:
                  ROUTE_COLORS[index % ROUTE_COLORS.length],
              }}
            />
            {routeDisplayName(route, index)}
          </button>
        ))}
      </div>
      <div className="map-attribution">
        图层数据：
        {[...new Set(visibleProviders.map(({ attribution }) => attribution))]
          .join(" · ")}
      </div>
    </div>
  );
}

export type AmapBasemapProps = BasemapViewportProps &
  Readonly<{
    layerRegistry?: MapLayerProviderRegistry<
      AmapMapLayerContext,
      AmapLayer
    >;
    defaultBaseLayerId?: string;
    defaultReferenceLayerIds?: readonly string[];
  }>;

export function AmapBasemap({
  layerRegistry = defaultAmapMapLayerRegistry,
  defaultBaseLayerId = "amap-satellite",
  defaultReferenceLayerIds,
  ...props
}: AmapBasemapProps) {
  const [config, setConfig] = useState<
    Awaited<ReturnType<typeof loadWebMapConfig>> | null
  >(null);

  useEffect(() => {
    let active = true;
    void loadWebMapConfig()
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active) setConfig({ enabled: false });
      });
    return () => {
      active = false;
    };
  }, []);

  if (!config?.enabled) {
    return <RouteMap {...props} />;
  }
  const enabledReferences =
    defaultReferenceLayerIds ??
    layerRegistry
      .providers("reference")
      .filter(({ defaultEnabled }) => defaultEnabled)
      .map(({ id }) => id);
  return (
    <AmapViewport
      {...props}
      defaultBaseLayerId={defaultBaseLayerId}
      defaultReferenceLayerIds={enabledReferences}
      keyValue={config.key}
      layerRegistry={layerRegistry}
      serviceHost={config.serviceHost}
    />
  );
}

export type AmapBasemapRendererOptions = Readonly<{
  id?: string;
  displayName?: string;
  layerRegistry?: MapLayerProviderRegistry<
    AmapMapLayerContext,
    AmapLayer
  >;
  defaultBaseLayerId?: string;
  defaultReferenceLayerIds?: readonly string[];
}>;

export function createAmapBasemapRenderer(
  options: AmapBasemapRendererOptions = {},
): BasemapRenderer {
  const layerRegistry =
    options.layerRegistry ?? defaultAmapMapLayerRegistry;
  const defaultBaseLayerId =
    options.defaultBaseLayerId ?? "amap-satellite";
  const baseProvider = layerRegistry.require(defaultBaseLayerId);
  if (baseProvider.kind !== "base") {
    throw new TypeError("AMAP_BASE_LAYER_PROVIDER_REQUIRED");
  }
  const defaultReferenceLayerIds =
    options.defaultReferenceLayerIds ??
    layerRegistry
      .providers("reference")
      .filter(({ defaultEnabled }) => defaultEnabled)
      .map(({ id }) => id);
  defaultReferenceLayerIds.forEach((id) => {
    if (layerRegistry.require(id).kind !== "reference") {
      throw new TypeError("AMAP_REFERENCE_LAYER_PROVIDER_REQUIRED");
    }
  });

  function ConfiguredAmapBasemap(props: BasemapViewportProps) {
    return (
      <AmapBasemap
        {...props}
        defaultBaseLayerId={defaultBaseLayerId}
        defaultReferenceLayerIds={defaultReferenceLayerIds}
        layerRegistry={layerRegistry}
      />
    );
  }

  return defineBasemapRenderer({
    id: options.id ?? "amap-jsapi",
    displayName: options.displayName ?? "高德地图",
    component: ConfiguredAmapBasemap,
  });
}

export const amapBasemapRenderer = createAmapBasemapRenderer();
