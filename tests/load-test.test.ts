import assert from "node:assert/strict";
import test from "node:test";
import { runLoadTest } from "../scripts/load-test.ts";

test("runs a bounded concurrent edge-read load gate", async () => {
  let active = 0;
  let maximumActive = 0;
  let clock = 0;
  const result = await runLoadTest({
    environment: {
      LOAD_TEST_BASE_URL: "https://staging.example.test",
      LOAD_TEST_REQUESTS: "12",
      LOAD_TEST_CONCURRENCY: "3",
      LOAD_TEST_P95_LIMIT_MS: "100",
    },
    now: () => {
      clock += 5;
      return clock;
    },
    fetcher: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return new Response(JSON.stringify({ status: "ready" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.requestCount, 12);
  assert.equal(result.concurrency, 3);
  assert.equal(result.successRate, 1);
  assert.equal(maximumActive, 3);
  assert.deepEqual(result.statusCounts, { "200": 12 });
});

test("requires explicit quota approval and fails closed on thresholds", async () => {
  const unapproved = await runLoadTest({
    environment: {
      LOAD_TEST_BASE_URL: "https://staging.example.test",
      LOAD_TEST_PROFILE: "route-plan",
    },
  });
  assert.equal(unapproved.code, "LOAD_TEST_CONFIGURATION_INVALID");

  const failed = await runLoadTest({
    environment: {
      LOAD_TEST_BASE_URL: "https://staging.example.test",
      LOAD_TEST_REQUESTS: "4",
      LOAD_TEST_CONCURRENCY: "2",
      LOAD_TEST_MIN_SUCCESS_PERCENT: "100",
    },
    now: () => 1_000,
    fetcher: async () => new Response(null, { status: 503 }),
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.code, "LOAD_TEST_THRESHOLDS_FAILED");
  assert.equal(failed.successRate, 0);
});

test("runs the approved route-plan profile without retries", async () => {
  const requestIds: string[] = [];
  const result = await runLoadTest({
    environment: {
      LOAD_TEST_BASE_URL: "https://staging.example.test",
      LOAD_TEST_PROFILE: "route-plan",
      LOAD_TEST_REQUESTS: "2",
      LOAD_TEST_CONCURRENCY: "1",
      LOAD_TEST_P95_LIMIT_MS: "1000",
      LOAD_TEST_CONFIRMATION:
        "staging-only-provider-quota-approved",
    },
    now: () => 1_000,
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        requestId: string;
      };
      requestIds.push(body.requestId);
      return new Response(
        JSON.stringify({
          schemaVersion: "1",
          status: "complete",
          routes: [{}],
        }),
      );
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.profile, "route-plan");
  assert.deepEqual(requestIds, ["load-test-1", "load-test-2"]);
});
