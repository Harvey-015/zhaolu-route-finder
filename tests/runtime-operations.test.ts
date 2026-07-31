import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { loadRuntimeConfig } from "../src/runtime/config.ts";
import {
  createJsonLogger,
  safeRequestLogFields,
} from "../src/runtime/logger.ts";
import {
  normalizedRoutePath,
  RuntimeMetrics,
} from "../src/runtime/metrics.ts";
import { FixedWindowRateLimiter } from "../src/runtime/rateLimit.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import { createNodeApiServer } from "../src/server-api/nodeServer.ts";

function environment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    AMAP_WEB_SERVICE_KEY: "amap-placeholder",
    ZHAOLU_SESSION_SECRET:
      "session-secret-at-least-thirty-two-characters",
    ZHAOLU_OBSERVABILITY_TOKEN:
      "metrics-token-at-least-thirty-two-characters",
    ...overrides,
  };
}

async function listen(
  server: ReturnType<typeof createNodeApiServer>,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function close(
  server: ReturnType<typeof createNodeApiServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("loads validated production config without exposing secret values", () => {
  const config = loadRuntimeConfig(
    environment({
      PORT: "9090",
      RATE_LIMIT_PLAN_PER_MINUTE: "12",
    }),
    "C:\\service",
  );

  assert.equal(config.port, 9090);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.rateLimits.planPerMinute, 12);
  assert.throws(
    () =>
      loadRuntimeConfig(
        environment({ ZHAOLU_SESSION_SECRET: "short" }),
      ),
    /ZHAOLU_SESSION_SECRET_REQUIRED/,
  );
  assert.throws(
    () =>
      loadRuntimeConfig(environment({ PORT: "70000" })),
    /PORT_INVALID/,
  );
});

test("fixed-window limits return a bounded Retry-After and reset", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({
    now: () => now,
    limits: {
      plan: { maximum: 2, windowMs: 60_000 },
      session: { maximum: 1, windowMs: 3_600_000 },
      "user-data": { maximum: 2, windowMs: 60_000 },
    },
  });

  assert.equal(limiter.consume("client", "plan").allowed, true);
  assert.equal(limiter.consume("client", "plan").remaining, 0);
  const blocked = limiter.consume("client", "plan");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  now += 60_000;
  assert.equal(limiter.consume("client", "plan").allowed, true);
});

test("API returns a stable rate-limit envelope before expensive work", async () => {
  const limiter = new FixedWindowRateLimiter({
    limits: {
      plan: { maximum: 1, windowMs: 60_000 },
      session: { maximum: 1, windowMs: 60_000 },
      "user-data": { maximum: 1, windowMs: 60_000 },
    },
  });
  const handler = createServerApi({
    planRoutes: async () => {
      throw new Error("not used");
    },
    rateLimiter: limiter,
  });
  const request = () =>
    new Request("http://localhost/api/v1/session", {
      method: "POST",
      headers: {
        "x-zhaolu-client-key": "same-client",
      },
    });

  assert.equal((await handler(request())).status, 503);
  const blocked = await handler(request());
  const body = (await blocked.json()) as {
    error: { code: string; retryable: boolean };
  };
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.deepEqual(body.error, {
    code: "RATE_LIMITED",
    retryable: true,
  });
});

test("metrics and structured logs normalize identifiers and omit queries", () => {
  const routeId = "11111111-1111-1111-1111-111111111111";
  assert.equal(
    normalizedRoutePath(
      `/api/v1/saved-routes/${routeId}/feedback`,
    ),
    "/api/v1/saved-routes/:routeId/feedback",
  );
  assert.deepEqual(
    safeRequestLogFields({
      method: "GET",
      pathname: `/api/v1/saved-routes/${routeId}`,
      status: 200,
      durationMs: 1.23456,
      requestId: "request-1",
    }),
    {
      method: "GET",
      path: "/api/v1/saved-routes/:routeId",
      status: 200,
      durationMs: 1.235,
      requestId: "request-1",
    },
  );

  const lines: string[] = [];
  const logger = createJsonLogger({
    write: (line) => lines.push(line),
    now: () => "2026-07-29T00:00:00.000Z",
  });
  logger.info("http_request", {
    path: "/",
    status: 200,
  });
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /authorization|secret|query/);
});

test("unified Node runtime serves secure static files and protected metrics", async () => {
  const root = mkdtempSync(join(tmpdir(), "zhaolu-runtime-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><title>找路</title>",
    "utf8",
  );
  writeFileSync(
    join(root, "assets", "app.js"),
    "console.log('ok')",
    "utf8",
  );
  const metrics = new RuntimeMetrics();
  const logs: string[] = [];
  const logger = createJsonLogger({
    write: (line) => logs.push(line),
  });
  const handler = createServerApi({
    planRoutes: async () => {
      throw new Error("not used");
    },
    readinessCheck: async () => ({
      database: "ok",
      staticFiles: "ok",
    }),
  });
  const token = "metrics-token-at-least-thirty-two-characters";
  const server = createNodeApiServer(handler, {
    staticRoot: root,
    metrics,
    logger,
    observabilityToken: token,
  });

  try {
    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;
    const home = await fetch(`${origin}/?token=do-not-log`);
    const asset = await fetch(`${origin}/assets/app.js`);
    const ready = await fetch(`${origin}/api/v1/ready`);
    const unauthorized = await fetch(`${origin}/internal/metrics`);
    const authorized = await fetch(`${origin}/internal/metrics`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const metricBody = await authorized.text();

    assert.equal(home.status, 200);
    assert.match(await home.text(), /<title>找路<\/title>/);
    assert.equal(
      home.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    assert.match(
      home.headers.get("content-security-policy") ?? "",
      /default-src 'self'/,
    );
    assert.equal(
      asset.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assert.equal(ready.status, 200);
    assert.equal(unauthorized.status, 401);
    assert.equal(authorized.status, 200);
    assert.match(metricBody, /zhaolu_http_requests_total/);
    assert.doesNotMatch(logs.join(""), /do-not-log|authorization/);
  } finally {
    if (server.listening) await close(server);
    rmSync(root, { recursive: true, force: true });
  }
});
