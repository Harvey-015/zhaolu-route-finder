import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runAmapSmoke,
} from "../scripts/smoke-amap.ts";
import type { AmapFetch } from "../src/adapters/amap/httpClient.ts";

async function fixture(name: string): Promise<unknown> {
  const contents = await readFile(
    new URL(`./fixtures/amap/${name}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(contents) as unknown;
}

test("skips the AMap smoke safely when the server key is missing", async () => {
  let requestCount = 0;
  const fetcher: AmapFetch = async () => {
    requestCount += 1;
    throw new Error("Network must not be used");
  };

  const result = await runAmapSmoke({ fetcher });

  assert.deepEqual(result, {
    status: "skipped",
    code: "AMAP_WEB_SERVICE_KEY_MISSING",
    requestCount: 0,
  });
  assert.equal(requestCount, 0);
});

test("limits the AMap smoke to one place and two route requests", async () => {
  const payloads = [
    await fixture("place-text-success.json"),
    await fixture("walking-leg-1.json"),
    await fixture("walking-leg-1.json"),
  ];
  let requestCount = 0;
  const fetcher: AmapFetch = async () => {
    const payload = payloads[requestCount];
    requestCount += 1;
    if (!payload) throw new Error("Unexpected smoke request");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await runAmapSmoke({
    apiKey: "fixture-key",
    fetcher,
  });

  assert.equal(result.status, "passed");
  assert.equal(result.requestCount, 3);
  assert.equal(requestCount, 3);
  if (result.status !== "passed") return;
  assert.equal(result.placeResolved, true);
  assert.equal(result.walking.wgs84Only, true);
  assert.equal(result.cycling.wgs84Only, true);
  assert.ok(result.walking.geometryPointCount >= 2);
  assert.ok(result.cycling.geometryPointCount >= 2);
});
