import { DatabaseSync } from "node:sqlite";
import type {
  FieldReport,
  SavedRouteRecord,
  SavedRouteSummary,
  UserDataStore,
  UserSession,
} from "./models.ts";

export const SQLITE_USER_DATA_SCHEMA_VERSION = 2;

const USER_DATA_MIGRATIONS: ReadonlyArray<
  Readonly<{ version: number; sql: string }>
> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS user_sessions (
        user_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS saved_routes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('running', 'cycling')),
        provider_id TEXT NOT NULL,
        distance_m REAL NOT NULL,
        duration_s REAL,
        score REAL NOT NULL,
        request_json TEXT NOT NULL,
        route_json TEXT,
        policy_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS saved_routes_user_created
        ON saved_routes(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS field_reports (
        id TEXT PRIMARY KEY,
        saved_route_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        note TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (saved_route_id) REFERENCES saved_routes(id)
          ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
          ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE saved_routes ADD COLUMN idempotency_key TEXT;
      CREATE UNIQUE INDEX saved_routes_user_idempotency
        ON saved_routes(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `,
  },
];

function schemaVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as
    | { user_version?: unknown }
    | undefined;
  const version = row?.user_version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error("DATABASE_SCHEMA_VERSION_INVALID");
  }
  return version;
}

function migrate(database: DatabaseSync): void {
  const currentVersion = schemaVersion(database);
  if (currentVersion > SQLITE_USER_DATA_SCHEMA_VERSION) {
    throw new Error("DATABASE_SCHEMA_VERSION_UNSUPPORTED");
  }
  const pending = USER_DATA_MIGRATIONS.filter(
    ({ version }) => version > currentVersion,
  ).sort((left, right) => left.version - right.version);
  for (const migration of pending) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the migration error; a failed rollback is not actionable here.
      }
      throw error;
    }
  }
  if (schemaVersion(database) !== SQLITE_USER_DATA_SCHEMA_VERSION) {
    throw new Error("DATABASE_SCHEMA_MIGRATION_INCOMPLETE");
  }
}

type SavedRouteRow = Readonly<{
  id: string;
  user_id: string;
  name: string;
  mode: "running" | "cycling";
  provider_id: string;
  distance_m: number;
  duration_s: number | null;
  score: number;
  request_json: string;
  route_json: string | null;
  policy_json: string;
  idempotency_key: string | null;
  created_at: number;
  expires_at: number;
}>;

function summary(row: SavedRouteRow): SavedRouteSummary {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    providerId: row.provider_id,
    distanceMeters: row.distance_m,
    durationSeconds: row.duration_s,
    score: row.score,
    hasGeometry: row.route_json !== null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class SqliteUserDataStore implements UserDataStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (!path.trim()) {
      throw new RangeError("DATABASE_PATH_REQUIRED");
    }
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
    });
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
      `);
      migrate(database);
    } catch (error) {
      database.close();
      throw error;
    }
    this.database = database;
  }

  isHealthy(): boolean {
    const result = this.database
      .prepare("SELECT 1 AS healthy")
      .get() as { healthy?: number } | undefined;
    return result?.healthy === 1;
  }

  createSession(session: UserSession): void {
    this.database
      .prepare(
        `INSERT INTO user_sessions (user_id, expires_at)
         VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at`,
      )
      .run(session.userId, session.expiresAt);
  }

  hasSession(userId: string, now: number): boolean {
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 AS found
           FROM user_sessions
           WHERE user_id = ? AND expires_at > ?`,
        )
        .get(userId, now),
    );
  }

  saveRoute(record: SavedRouteRecord): void {
    this.database
      .prepare(
        `INSERT INTO saved_routes (
          id, user_id, name, mode, provider_id, distance_m,
          duration_s, score, request_json, route_json, policy_json,
          idempotency_key, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.name,
        record.mode,
        record.providerId,
        record.distanceMeters,
        record.durationSeconds,
        record.score,
        JSON.stringify(record.request),
        record.route === null ? null : JSON.stringify(record.route),
        JSON.stringify(record.policy),
        record.idempotencyKey,
        record.createdAt,
        record.expiresAt,
      );
  }

  findSavedRouteByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    now: number,
  ): SavedRouteSummary | null {
    const row = this.database
      .prepare(
        `SELECT *
         FROM saved_routes
         WHERE user_id = ? AND idempotency_key = ?`,
      )
      .get(userId, idempotencyKey) as
      | SavedRouteRow
      | undefined;
    if (row && row.expires_at <= now) {
      this.database
        .prepare("DELETE FROM saved_routes WHERE id = ? AND user_id = ?")
        .run(row.id, userId);
      return null;
    }
    return row ? summary(row) : null;
  }

  listSavedRoutes(
    userId: string,
    now: number,
  ): readonly SavedRouteSummary[] {
    return (
      this.database
        .prepare(
          `SELECT *
           FROM saved_routes
           WHERE user_id = ? AND expires_at > ?
           ORDER BY created_at DESC
           LIMIT 100`,
        )
        .all(userId, now) as SavedRouteRow[]
    ).map(summary);
  }

  getSavedRoute(
    userId: string,
    routeId: string,
    now: number,
  ): SavedRouteRecord | null {
    const row = this.database
      .prepare(
        `SELECT *
         FROM saved_routes
         WHERE id = ? AND user_id = ? AND expires_at > ?`,
      )
      .get(routeId, userId, now) as SavedRouteRow | undefined;
    if (!row) return null;
    return {
      ...summary(row),
      userId: row.user_id,
      idempotencyKey: row.idempotency_key,
      request: JSON.parse(row.request_json),
      route: row.route_json ? JSON.parse(row.route_json) : null,
      policy: JSON.parse(row.policy_json),
    } as SavedRouteRecord;
  }

  deleteSavedRoute(userId: string, routeId: string): boolean {
    const result = this.database
      .prepare(
        "DELETE FROM saved_routes WHERE id = ? AND user_id = ?",
      )
      .run(routeId, userId);
    return result.changes === 1;
  }

  addFieldReport(report: FieldReport): void {
    this.database
      .prepare(
        `INSERT INTO field_reports (
          id, saved_route_id, user_id, rating, note, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        report.id,
        report.savedRouteId,
        report.userId,
        report.rating,
        report.note,
        report.createdAt,
        report.expiresAt,
      );
  }

  purgeExpired(now: number): number {
    const reports = this.database
      .prepare("DELETE FROM field_reports WHERE expires_at <= ?")
      .run(now).changes;
    const routes = this.database
      .prepare("DELETE FROM saved_routes WHERE expires_at <= ?")
      .run(now).changes;
    const sessions = this.database
      .prepare("DELETE FROM user_sessions WHERE expires_at <= ?")
      .run(now).changes;
    return Number(reports) + Number(routes) + Number(sessions);
  }

  close(): void {
    this.database.close();
  }
}
