import type { ComponentType } from "react";
import type { ApiRecommendedRoute } from "../../src/server-api/contracts.ts";

export type BasemapViewportProps = Readonly<{
  routes: readonly ApiRecommendedRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
}>;

export type BasemapRenderer = Readonly<{
  id: string;
  displayName: string;
  component: ComponentType<BasemapViewportProps>;
}>;

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function defineBasemapRenderer(
  renderer: BasemapRenderer,
): BasemapRenderer {
  if (!EXTENSION_ID_PATTERN.test(renderer.id)) {
    throw new TypeError("BASEMAP_RENDERER_ID_INVALID");
  }
  if (!renderer.displayName.trim()) {
    throw new TypeError("BASEMAP_RENDERER_NAME_REQUIRED");
  }
  return Object.freeze({ ...renderer });
}

export class BasemapRendererRegistry {
  private readonly renderers: ReadonlyMap<string, BasemapRenderer>;

  constructor(renderers: readonly BasemapRenderer[]) {
    const registered = new Map<string, BasemapRenderer>();
    for (const renderer of renderers) {
      const normalized = defineBasemapRenderer(renderer);
      if (registered.has(normalized.id)) {
        throw new TypeError("BASEMAP_RENDERER_DUPLICATE");
      }
      registered.set(normalized.id, normalized);
    }
    this.renderers = registered;
  }

  get(id: string): BasemapRenderer | undefined {
    return this.renderers.get(id);
  }

  require(id: string): BasemapRenderer {
    const renderer = this.get(id);
    if (!renderer) {
      throw new Error("BASEMAP_RENDERER_NOT_REGISTERED");
    }
    return renderer;
  }

  ids(): readonly string[] {
    return [...this.renderers.keys()];
  }
}
