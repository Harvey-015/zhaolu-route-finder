import type { WorldCoverRasterSource } from "../../src/adapters/worldcover/rasterSource.ts";
import { WorldCoverSceneryProvider } from "../../src/adapters/worldcover/sceneryProvider.ts";
import {
  gcj02Point,
  wgs84Point,
} from "../../src/route-recommendation/coordinates.ts";
import type { SceneryProvider } from "../../src/route-recommendation/ports.ts";

const rasterSource: WorldCoverRasterSource = {
  async readGrid(request) {
    return {
      bounds: request.bounds,
      width: request.width,
      height: request.height,
      values: new Uint8Array(request.width * request.height),
    };
  },
};

const provider: SceneryProvider = new WorldCoverSceneryProvider({
  rasterSource,
});

void provider.findAnchors(
  {
    origin: wgs84Point(120.149, 30.259),
    targetDistanceMeters: 5_000,
    preferences: {
      greenery: 1,
      waterfront: 1,
      lowTraffic: 1,
      comfort: 1,
    },
    limit: 4,
  },
  { requestId: "type-contract" },
);

void provider.findAnchors(
  {
    // @ts-expect-error WorldCover and the core accept WGS-84 only.
    origin: gcj02Point(120.153, 30.257),
    targetDistanceMeters: 5_000,
    preferences: {
      greenery: 1,
      waterfront: 1,
      lowTraffic: 1,
      comfort: 1,
    },
    limit: 4,
  },
  { requestId: "type-contract" },
);
