import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { WorldCoverRasterSource } from "../src/adapters/worldcover/rasterSource.ts";
import type {
  D1DatabaseBinding,
  D1PreparedStatement,
  D1Primitive,
  D1Result,
  R2BucketBinding,
  R2ObjectBodyBinding,
} from "../src/cloudflare/bindings.ts";
import { D1UserDataStore } from "../src/cloudflare/d1UserDataStore.ts";
import { R2CachedWorldCoverRasterSource } from "../src/cloudflare/r2WorldCoverCache.ts";
import { resolveFixtureRouteDeliveryPolicy } from "../src/route-delivery/policy.ts";
import type { PlanRoutesApiRequest } from "../src/server-api/contracts.ts";
import { SignedSessionService } from "../src/user-data/auth.ts";
import { UserDataService } from "../src/user-data/service.ts";
import { DELIVERY_TEST_ROUTE } from "./fixtures/delivery.ts";

class TestD1Statement implements D1PreparedStatement {
  private readonly database: DatabaseSync;
  private readonly query: string;
  private readonly values: readonly D1Primitive[];

  constructor(
    database: DatabaseSync,
    query: string,
    values: readonly D1Primitive[] = [],
  ) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values: readonly D1Primitive[]): D1PreparedStatement {
    return new TestD1Statement(this.database, this.query, values);
  }

  private parameters(): readonly (null | number | string)[] {
    return this.values.map((value) => {
      if (
        value === null ||
        typeof value === "number" ||
        typeof value === "string"
      ) {
        return value;
      }
      throw new TypeError("TEST_D1_PARAMETER_UNSUPPORTED");
    });
  }

  async first<T>(): Promise<T | null> {
    const row = this.database
      .prepare(this.query)
      .get(...this.parameters());
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.database
      .prepare(this.query)
      .all(...this.parameters()) as T[];
    return { success: true, results: rows, meta: { changes: 0 } };
  }

  async run<T>(): Promise<D1Result<T>> {
    const result = this.database
      .prepare(this.query)
      .run(...this.parameters());
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }
}

class TestD1Database implements D1DatabaseBinding {
  readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  prepare(query: string): D1PreparedStatement {
    return new TestD1Statement(this.database, query);
  }

  async batch<T>(
    statements: readonly D1PreparedStatement[],
  ): Promise<readonly D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }
}

const REQUEST: PlanRoutesApiRequest = {
  schemaVersion: "1",
  start: { kind: "query", query: "杭州西湖" },
  mode: "running",
  targetDistanceMeters: 5_000,
  preferences: {
    greenery: 1,
    waterfront: 1,
    lowTraffic: 1,
    comfort: 0,
  },
};

test("D1 store supports the shared user-data service contract", async () => {
  let now = 1_800_000_000_000;
  const database = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
  });
  database.exec(
    readFileSync("migrations/0001_user_data.sql", "utf8"),
  );
  const store = new D1UserDataStore(new TestD1Database(database));
  const service = new UserDataService({
    store,
    sessions: new SignedSessionService(
      "cloudflare-test-session-secret-at-least-32-characters",
      { now: () => now },
    ),
    policyResolver: resolveFixtureRouteDeliveryPolicy,
    now: () => now,
  });

  try {
    assert.equal(await store.isHealthy(), true);
    const session = await service.issueSession();
    const request = new Request("https://example.test", {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const userId = await service.authenticate(request);
    const saved = await service.saveRoute(
      userId,
      {
        schemaVersion: "1",
        name: "D1 route",
        request: REQUEST,
        route: DELIVERY_TEST_ROUTE,
      },
      "d1-operation-1",
    );
    const duplicate = await service.saveRoute(
      userId,
      {
        schemaVersion: "1",
        name: "ignored duplicate",
        request: REQUEST,
        route: DELIVERY_TEST_ROUTE,
      },
      "d1-operation-1",
    );

    assert.equal(duplicate.id, saved.id);
    assert.equal((await service.listSavedRoutes(userId)).length, 1);
    assert.equal(
      (await store.getSavedRoute(userId, saved.id, now))?.route?.id,
      DELIVERY_TEST_ROUTE.id,
    );
    await service.addFieldReport(userId, saved.id, {
      schemaVersion: "1",
      rating: 5,
      note: "works on D1",
    });

    now += 31 * 24 * 60 * 60_000;
    assert.ok((await service.purgeExpired()) >= 1);
    assert.deepEqual(await service.listSavedRoutes(userId), []);
  } finally {
    database.close();
  }
});

class MemoryR2Bucket implements R2BucketBinding {
  readonly objects = new Map<
    string,
    Readonly<{
      bytes: Uint8Array;
      customMetadata?: Readonly<Record<string, string>>;
    }>
  >();

  async get(key: string): Promise<R2ObjectBodyBinding | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      customMetadata: object.customMetadata,
      async arrayBuffer() {
        return object.bytes.slice().buffer;
      },
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: Readonly<{
      httpMetadata?: Readonly<{ contentType?: string }>;
      customMetadata?: Readonly<Record<string, string>>;
    }>,
  ): Promise<void> {
    if (typeof value === "string") {
      throw new TypeError("TEST_R2_BINARY_REQUIRED");
    }
    const bytes = ArrayBuffer.isView(value)
      ? new Uint8Array(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        ).slice()
      : new Uint8Array(value.slice(0));
    this.objects.set(key, {
      bytes,
      customMetadata: options?.customMetadata,
    });
  }
}

test("R2 WorldCover cache reuses processed grids", async () => {
  let reads = 0;
  const bucket = new MemoryR2Bucket();
  const source: WorldCoverRasterSource = {
    async readGrid(request) {
      reads += 1;
      return {
        bounds: request.bounds,
        width: request.width,
        height: request.height,
        values: new Uint8Array(request.width * request.height).fill(10),
      };
    },
  };
  const cache = new R2CachedWorldCoverRasterSource({
    bucket,
    source,
    now: () => 1_800_000_000_000,
  });
  const request = {
    bounds: {
      minLongitude: 120,
      minLatitude: 30,
      maxLongitude: 120.1,
      maxLatitude: 30.1,
    },
    width: 4,
    height: 3,
  } as const;

  const first = await cache.readGrid(request, { requestId: "first" });
  const second = await cache.readGrid(request, { requestId: "second" });

  assert.equal(reads, 1);
  assert.equal(bucket.objects.size, 1);
  assert.deepEqual(second.values, first.values);
});
