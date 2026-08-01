import assert from "node:assert/strict";
import test from "node:test";
import { runOperationsSmoke } from "../scripts/smoke-operations.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function metrics(backupAgeHours = 1): string {
  const timestamp = (NOW - backupAgeHours * 60 * 60_000) / 1_000;
  return [
    "zhaolu_process_start_time_seconds 1785530000",
    `zhaolu_sqlite_backup_last_success_timestamp_seconds ${timestamp}`,
    `zhaolu_sqlite_backup_last_restore_verification_timestamp_seconds ${timestamp}`,
    "zhaolu_sqlite_backup_size_bytes 4096",
    "",
  ].join("\n");
}

function environment(): NodeJS.ProcessEnv {
  return {
    OPERATIONS_BASE_URL: "https://routes.example.test",
    ZHAOLU_OBSERVABILITY_TOKEN:
      "observability-token-at-least-thirty-two-characters",
  };
}

test("validates protected metrics, fresh backup restoration and readiness", async () => {
  const authorizations: Array<string | null> = [];
  const result = await runOperationsSmoke({
    environment: environment(),
    now: () => NOW,
    fetcher: async (input, init) => {
      const url = new URL(input.toString());
      const authorization = new Headers(init?.headers).get(
        "authorization",
      );
      authorizations.push(authorization);
      if (url.pathname === "/internal/metrics" && !authorization) {
        return new Response(null, { status: 401 });
      }
      if (url.pathname === "/internal/metrics") {
        return new Response(metrics());
      }
      return new Response(JSON.stringify({ status: "ready" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(result, {
    status: "passed",
    requestCount: 3,
    checks: [
      "metrics-protected",
      "backup-and-restore-fresh",
      "ready",
    ],
  });
  assert.deepEqual(authorizations, [
    null,
    "Bearer observability-token-at-least-thirty-two-characters",
    null,
  ]);
});

test("fails closed for stale backup metrics and invalid configuration", async () => {
  const stale = await runOperationsSmoke({
    environment: environment(),
    now: () => NOW,
    fetcher: async (_input, init) =>
      new Headers(init?.headers).has("authorization")
        ? new Response(metrics(30))
        : new Response(null, { status: 401 }),
  });
  assert.equal(stale.status, "failed");
  assert.equal(stale.code, "OPERATIONS_REQUEST_FAILED");

  const invalid = await runOperationsSmoke({
    environment: {
      ...environment(),
      OPERATIONS_BASE_URL: "http://routes.example.test",
    },
  });
  assert.deepEqual(invalid, {
    status: "failed",
    requestCount: 0,
    checks: [],
    code: "OPERATIONS_CONFIGURATION_INVALID",
  });
});
