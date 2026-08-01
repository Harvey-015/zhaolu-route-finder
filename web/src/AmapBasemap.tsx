import { useEffect, useRef, useState } from "react";
import { wgs84ToGcj02 } from "../../src/adapters/amap/coordinates.ts";
import { wgs84Point } from "../../src/route-recommendation/coordinates.ts";
import type { ApiRecommendedRoute } from "../../src/server-api/contracts.ts";
import {
  defineBasemapRenderer,
  type BasemapViewportProps,
} from "./basemap.ts";
import { loadWebMapConfig } from "./mapConfig.ts";
import { ROUTE_COLORS, routeDisplayName } from "./model.ts";
import { RouteMap } from "./RouteMap.tsx";

type AmapOverlay = Readonly<{
  on?: (event: string, callback: () => void) => void;
}>;

type AmapMap = Readonly<{
  add(overlays: AmapOverlay | readonly AmapOverlay[]): void;
  remove(overlays: readonly AmapOverlay[]): void;
  setFitView(
    overlays?: readonly AmapOverlay[],
    immediately?: boolean,
    avoid?: readonly number[],
  ): void;
  destroy(): void;
}>;

type AmapNamespace = Readonly<{
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
}>;

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

function AmapViewport({
  routes,
  selectedRouteId,
  onSelectRoute,
  keyValue,
  serviceHost,
}: BasemapViewportProps &
  Readonly<{ keyValue: string; serviceHost: string }>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AmapMap | null>(null);
  const amapRef = useRef<AmapNamespace | null>(null);
  const overlaysRef = useRef<readonly AmapOverlay[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAmapJsApi(keyValue, serviceHost)
      .then((AMap) => {
        if (!active || !containerRef.current) return;
        amapRef.current = AMap;
        mapRef.current = new AMap.Map(containerRef.current, {
          zoom: 13,
          viewMode: "2D",
          mapStyle: "amap://styles/normal",
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
  }, [keyValue, serviceHost]);

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

    const start = routeGeometryForAmap(selected)[0];
    if (start) {
      overlays.push(
        new AMap.CircleMarker({
          center: start,
          radius: 9,
          strokeColor: "#102e2a",
          strokeWeight: 4,
          fillColor: "#dfff64",
          fillOpacity: 1,
          zIndex: 80,
        }),
      );
    }
    map.add(overlays);
    map.setFitView(overlays, false, [90, 70, 110, 70]);
    overlaysRef.current = overlays;
  }, [onSelectRoute, ready, routes, selectedRouteId]);

  if (failed) {
    return (
      <RouteMap
        onSelectRoute={onSelectRoute}
        routes={routes}
        selectedRouteId={selectedRouteId}
      />
    );
  }

  return (
    <div className="route-map-wrap amap-map-wrap">
      <div className="map-caption">
        <div>
          <p className="eyebrow">高德地图</p>
          <strong>真实道路路线对比</strong>
        </div>
        <span className="map-note">
          {ready ? "JS API 2.0" : "地图加载中…"}
        </span>
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
    </div>
  );
}

export function AmapBasemap(props: BasemapViewportProps) {
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

  if (props.routes.length === 0 || !config?.enabled) {
    return <RouteMap {...props} />;
  }
  return (
    <AmapViewport
      {...props}
      keyValue={config.key}
      serviceHost={config.serviceHost}
    />
  );
}

export const amapBasemapRenderer = defineBasemapRenderer({
  id: "amap-jsapi",
  displayName: "高德地图",
  component: AmapBasemap,
});
