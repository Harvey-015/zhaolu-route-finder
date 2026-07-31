import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { resolveFixtureRouteDeliveryPolicy } from "../src/route-delivery/policy.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import type { PlanRoutesApiRequest } from "../src/server-api/contracts.ts";
import { SignedSessionService } from "../src/user-data/auth.ts";
import {
  UserDataError,
  UserDataService,
} from "../src/user-data/service.ts";
import {
  SQLITE_USER_DATA_SCHEMA_VERSION,
  SqliteUserDataStore,
} from "../src/user-data/sqliteStore.ts";
import { DELIVERY_TEST_ROUTE } from "./fixtures/delivery.ts";

const REQUEST: PlanRoutesApiRequest = {
  schemaVersion: "1",
  requestId: "saved-route-test",
  start: {
    kind: "query",
    query: "杭州西湖",
  },
  mode: "running",
  targetDistanceMeters: 5_000,
  preferences: {
    greenery: 1,
    waterfront: 1,
    lowTraffic: 1,
    comfort: 0,
  },
  maxResults: 3,
};

function jsonRequest(
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Request {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("issues an authenticated session and manages saved routes and feedback", async () => {
  let now = 1_800_000_000_000;
  const store = new SqliteUserDataStore(":memory:");
  const sessions = new SignedSessionService(
    "test-session-secret-at-least-32-characters",
    {
      now: () => now,
    },
  );
  const userData = new UserDataService({
    store,
    sessions,
    policyResolver: resolveFixtureRouteDeliveryPolicy,
    now: () => now,
  });
  const handler = createServerApi({
    planRoutes: async () => {
      throw new Error("not used");
    },
    userData,
  });

  try {
    const unauthorized = await handler(
      jsonRequest("/api/v1/saved-routes", "GET"),
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(
      unauthorized.headers.get("www-authenticate"),
      "Bearer",
    );

    const sessionResponse = await handler(
      jsonRequest("/api/v1/session", "POST"),
    );
    const sessionBody = (await sessionResponse.json()) as {
      session: { token: string; expiresAt: number };
    };
    assert.equal(sessionResponse.status, 201);
    assert.match(sessionBody.session.token, /^zhaolu\.v1\./);

    const saveResponse = await handler(
      jsonRequest(
        "/api/v1/saved-routes",
        "POST",
        {
          schemaVersion: "1",
          name: "西湖晨跑",
          request: REQUEST,
          route: DELIVERY_TEST_ROUTE,
        },
        sessionBody.session.token,
      ),
    );
    const saveBody = (await saveResponse.json()) as {
      route: { id: string; hasGeometry: boolean };
    };
    assert.equal(saveResponse.status, 201);
    assert.equal(saveBody.route.hasGeometry, true);

    const listResponse = await handler(
      jsonRequest(
        "/api/v1/saved-routes",
        "GET",
        undefined,
        sessionBody.session.token,
      ),
    );
    const listBody = (await listResponse.json()) as {
      routes: Array<{ id: string; name: string }>;
    };
    assert.equal(listBody.routes.length, 1);
    assert.equal(listBody.routes[0]?.id, saveBody.route.id);
    assert.equal(listBody.routes[0]?.name, "西湖晨跑");

    const feedbackResponse = await handler(
      jsonRequest(
        `/api/v1/saved-routes/${saveBody.route.id}/feedback`,
        "POST",
        {
          schemaVersion: "1",
          rating: 5,
          note: "树荫很多",
        },
        sessionBody.session.token,
      ),
    );
    const feedbackBody = (await feedbackResponse.json()) as {
      report: { rating: number; note: string };
    };
    assert.equal(feedbackResponse.status, 201);
    assert.equal(feedbackBody.report.rating, 5);
    assert.equal(feedbackBody.report.note, "树荫很多");

    const deleteResponse = await handler(
      jsonRequest(
        `/api/v1/saved-routes/${saveBody.route.id}`,
        "DELETE",
        undefined,
        sessionBody.session.token,
      ),
    );
    assert.equal(deleteResponse.status, 200);

    now += 31 * 24 * 60 * 60 * 1_000;
    assert.ok(userData.purgeExpired() >= 1);
  } finally {
    store.close();
  }
});

test("stores only metadata for an AMap route policy", () => {
  const now = 1_800_000_000_000;
  const store = new SqliteUserDataStore(":memory:");
  const sessions = new SignedSessionService(
    "test-session-secret-at-least-32-characters",
    { now: () => now },
  );
  const userData = new UserDataService({
    store,
    sessions,
    policyResolver: resolveFixtureRouteDeliveryPolicy,
    now: () => now,
  });

  try {
    const issued = userData.issueSession();
    const authRequest = new Request("http://localhost", {
      headers: {
        authorization: `Bearer ${issued.token}`,
      },
    });
    const userId = userData.authenticate(authRequest);
    const summary = userData.saveRoute(userId, {
      schemaVersion: "1",
      name: "高德路线",
      request: REQUEST,
      route: {
        ...DELIVERY_TEST_ROUTE,
        source: {
          providerId: "amap-route",
        },
        delivery: resolveFixtureRouteDeliveryPolicy("amap-route"),
      },
    });
    const record = store.getSavedRoute(userId, summary.id, now);

    assert.equal(summary.hasGeometry, false);
    assert.equal(record?.route, null);
    assert.equal(record?.policy.persistence, "metadata-only");
  } finally {
    store.close();
  }
});

test("rejects malformed saved-route inputs before persistence", () => {
  const now = 1_800_000_000_000;
  const store = new SqliteUserDataStore(":memory:");
  const userData = new UserDataService({
    store,
    sessions: new SignedSessionService(
      "test-session-secret-at-least-32-characters",
      { now: () => now },
    ),
    policyResolver: resolveFixtureRouteDeliveryPolicy,
    now: () => now,
  });
  const issued = userData.issueSession();
  const userId = userData.authenticate(
    new Request("http://localhost", {
      headers: { authorization: `Bearer ${issued.token}` },
    }),
  );
  const valid = {
    schemaVersion: "1",
    name: "严格验证路线",
    request: REQUEST,
    route: DELIVERY_TEST_ROUTE,
  };
  const invalidValues: unknown[] = [
    { ...valid, unexpected: true },
    {
      ...valid,
      request: { ...REQUEST, targetDistanceMeters: -1 },
    },
    {
      ...valid,
      request: {
        ...REQUEST,
        preferences: { ...REQUEST.preferences, greenery: 2 },
      },
    },
    {
      ...valid,
      route: { ...DELIVERY_TEST_ROUTE, distanceMeters: -1 },
    },
    {
      ...valid,
      route: {
        ...DELIVERY_TEST_ROUTE,
        geometry: {
          type: "LineString",
          coordinates: [["120", 30], [120, 30]],
        },
      },
    },
    {
      ...valid,
      route: {
        ...DELIVERY_TEST_ROUTE,
        score: { ...DELIVERY_TEST_ROUTE.score, total: -5 },
      },
    },
    {
      ...valid,
      route: {
        ...DELIVERY_TEST_ROUTE,
        delivery: {
          ...DELIVERY_TEST_ROUTE.delivery,
          policyVersion: "forged",
        },
      },
    },
  ];

  try {
    invalidValues.forEach((value) => {
      assert.throws(
        () => userData.saveRoute(userId, value),
        (error: unknown) =>
          error instanceof UserDataError &&
          error.status === 400 &&
          error.code === "INVALID_REQUEST",
      );
    });
    assert.deepEqual(userData.listSavedRoutes(userId), []);
  } finally {
    store.close();
  }
});

test("migrates legacy SQLite files and rejects newer schemas", () => {
  const root = mkdtempSync(join(tmpdir(), "zhaolu-migrations-"));
  const legacyPath = join(root, "legacy.sqlite");
  const futurePath = join(root, "future.sqlite");
  const expiresAt = 1_900_000_000_000;

  try {
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      CREATE TABLE user_sessions (
        user_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      ) STRICT;
      INSERT INTO user_sessions (user_id, expires_at)
      VALUES ('legacy-user', ${expiresAt});
    `);
    legacy.close();

    const migrated = new SqliteUserDataStore(legacyPath);
    assert.equal(migrated.hasSession("legacy-user", expiresAt - 1), true);
    migrated.close();

    const inspected = new DatabaseSync(legacyPath);
    const version = inspected.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(
      version.user_version,
      SQLITE_USER_DATA_SCHEMA_VERSION,
    );
    inspected.close();

    const future = new DatabaseSync(futurePath);
    future.exec(
      `PRAGMA user_version = ${SQLITE_USER_DATA_SCHEMA_VERSION + 1}`,
    );
    future.close();
    assert.throws(
      () => new SqliteUserDataStore(futurePath),
      /DATABASE_SCHEMA_VERSION_UNSUPPORTED/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deduplicates saved routes by user-scoped idempotency key", () => {
  let now = 1_800_000_000_000;
  const store = new SqliteUserDataStore(":memory:");
  const userData = new UserDataService({
    store,
    sessions: new SignedSessionService(
      "test-session-secret-at-least-32-characters",
      { now: () => now },
    ),
    policyResolver: resolveFixtureRouteDeliveryPolicy,
    now: () => now,
  });

  try {
    const session = userData.issueSession();
    const userId = userData.authenticate(
      new Request("http://localhost", {
        headers: { authorization: `Bearer ${session.token}` },
      }),
    );
    const input = {
      schemaVersion: "1",
      name: "幂等收藏",
      request: REQUEST,
      route: DELIVERY_TEST_ROUTE,
    };
    const first = userData.saveRoute(userId, input, "save-operation-1");
    const second = userData.saveRoute(
      userId,
      { ...input, name: "不会产生第二条" },
      "save-operation-1",
    );

    assert.equal(second.id, first.id);
    assert.equal(userData.listSavedRoutes(userId).length, 1);

    now += 30 * 24 * 60 * 60 * 1_000;
    const afterExpiry = userData.saveRoute(
      userId,
      input,
      "save-operation-1",
    );
    assert.notEqual(afterExpiry.id, first.id);
    assert.equal(userData.listSavedRoutes(userId).length, 1);
  } finally {
    store.close();
  }
});
