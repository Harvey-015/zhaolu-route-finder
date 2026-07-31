import assert from "node:assert/strict";
import test from "node:test";
import {
  runWorldCoverSmoke,
} from "../scripts/smoke-worldcover.ts";
import type {
  WorldCoverGridRequest,
  WorldCoverRasterSource,
} from "../src/adapters/worldcover/rasterSource.ts";

class GreenRasterSource implements WorldCoverRasterSource {
  readCount = 0;

  async readGrid(request: WorldCoverGridRequest) {
    this.readCount += 1;
    return {
      bounds: request.bounds,
      width: request.width,
      height: request.height,
      values: new Uint8Array(
        request.width * request.height,
      ).fill(10),
    };
  }
}

test("skips the WorldCover smoke without touching a raster source", async () => {
  const rasterSource = new GreenRasterSource();

  const result = await runWorldCoverSmoke({
    enabled: false,
    rasterSource,
  });

  assert.deepEqual(result, {
    status: "skipped",
    code: "WORLDCOVER_SMOKE_DISABLED",
    rasterReadCount: 0,
  });
  assert.equal(rasterSource.readCount, 0);
});

test("limits the WorldCover smoke to one small raster read", async () => {
  const rasterSource = new GreenRasterSource();

  const result = await runWorldCoverSmoke({
    enabled: true,
    rasterSource,
  });

  assert.equal(result.status, "passed");
  assert.equal(result.rasterReadCount, 1);
  assert.equal(rasterSource.readCount, 1);
  if (result.status !== "passed") return;
  assert.equal(result.availability, "partial");
  assert.equal(result.greenCoverage.value, 1);
  assert.equal(result.greenCoverage.confidence, 1);
  assert.equal(result.waterfrontProximity.value, 0);
  assert.equal(result.builtUpExposure.value, 0);
  assert.equal(result.roadComfortMissing, true);
});
