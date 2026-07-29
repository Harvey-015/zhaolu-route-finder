import assert from "node:assert/strict";
import test from "node:test";
import {
  runServerApiSmoke,
} from "../scripts/smoke-server-api.ts";

test("serves the complete API flow over a local HTTP port", async () => {
  const result = await runServerApiSmoke();

  assert.equal(result.status, "passed");
  assert.equal(result.httpRequestCount, 3);
  assert.equal(result.planCallCount, 1);
  if (result.status !== "passed") return;
  assert.ok(result.routeCount >= 1);
  assert.equal(result.geometryType, "LineString");
  assert.equal(result.requestIdPreserved, true);
});
