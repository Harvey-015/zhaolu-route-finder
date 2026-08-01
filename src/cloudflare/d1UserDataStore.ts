import type {
  FieldReport,
  SavedRouteRecord,
  SavedRouteSummary,
  UserDataStore,
  UserSession,
} from "../user-data/models.ts";
import type {
  D1DatabaseBinding,
  D1Result,
} from "./bindings.ts";

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

function routeSummary(row: SavedRouteRow): SavedRouteSummary {
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

function changes(result: D1Result): number {
  const value = result.meta?.changes;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

export class D1UserDataStore implements UserDataStore {
  private readonly database: D1DatabaseBinding;

  constructor(database: D1DatabaseBinding) {
    this.database = database;
  }

  async isHealthy(): Promise<boolean> {
    const row = await this.database
      .prepare("SELECT 1 AS healthy")
      .first<{ healthy: number }>();
    return row?.healthy === 1;
  }

  async createSession(session: UserSession): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO user_sessions (user_id, expires_at)
         VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE
         SET expires_at = excluded.expires_at`,
      )
      .bind(session.userId, session.expiresAt)
      .run();
  }

  async hasSession(userId: string, now: number): Promise<boolean> {
    const row = await this.database
      .prepare(
        `SELECT 1 AS found
         FROM user_sessions
         WHERE user_id = ? AND expires_at > ?`,
      )
      .bind(userId, now)
      .first<{ found: number }>();
    return row?.found === 1;
  }

  async deleteUserData(userId: string): Promise<boolean> {
    const result = await this.database
      .prepare("DELETE FROM user_sessions WHERE user_id = ?")
      .bind(userId)
      .run();
    return changes(result) === 1;
  }

  async saveRoute(record: SavedRouteRecord): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO saved_routes (
          id, user_id, name, mode, provider_id, distance_m,
          duration_s, score, request_json, route_json, policy_json,
          idempotency_key, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
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
      )
      .run();
  }

  async findSavedRouteByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    now: number,
  ): Promise<SavedRouteSummary | null> {
    const row = await this.database
      .prepare(
        `SELECT *
         FROM saved_routes
         WHERE user_id = ? AND idempotency_key = ?`,
      )
      .bind(userId, idempotencyKey)
      .first<SavedRouteRow>();
    if (!row) return null;
    if (row.expires_at <= now) {
      await this.database
        .prepare("DELETE FROM saved_routes WHERE id = ? AND user_id = ?")
        .bind(row.id, userId)
        .run();
      return null;
    }
    return routeSummary(row);
  }

  async listSavedRoutes(
    userId: string,
    now: number,
  ): Promise<readonly SavedRouteSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT *
         FROM saved_routes
         WHERE user_id = ? AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .bind(userId, now)
      .all<SavedRouteRow>();
    return (result.results ?? []).map(routeSummary);
  }

  async getSavedRoute(
    userId: string,
    routeId: string,
    now: number,
  ): Promise<SavedRouteRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT *
         FROM saved_routes
         WHERE id = ? AND user_id = ? AND expires_at > ?`,
      )
      .bind(routeId, userId, now)
      .first<SavedRouteRow>();
    if (!row) return null;
    return {
      ...routeSummary(row),
      userId: row.user_id,
      idempotencyKey: row.idempotency_key,
      request: JSON.parse(row.request_json),
      route: row.route_json ? JSON.parse(row.route_json) : null,
      policy: JSON.parse(row.policy_json),
    } as SavedRouteRecord;
  }

  async deleteSavedRoute(
    userId: string,
    routeId: string,
  ): Promise<boolean> {
    const result = await this.database
      .prepare("DELETE FROM saved_routes WHERE id = ? AND user_id = ?")
      .bind(routeId, userId)
      .run();
    return changes(result) === 1;
  }

  async addFieldReport(report: FieldReport): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO field_reports (
          id, saved_route_id, user_id, rating, note, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        report.id,
        report.savedRouteId,
        report.userId,
        report.rating,
        report.note,
        report.createdAt,
        report.expiresAt,
      )
      .run();
  }

  async purgeExpired(now: number): Promise<number> {
    const results = await this.database.batch([
      this.database
        .prepare("DELETE FROM field_reports WHERE expires_at <= ?")
        .bind(now),
      this.database
        .prepare("DELETE FROM saved_routes WHERE expires_at <= ?")
        .bind(now),
      this.database
        .prepare("DELETE FROM user_sessions WHERE expires_at <= ?")
        .bind(now),
    ]);
    return results.reduce(
      (total, result) => total + changes(result),
      0,
    );
  }

  async close(): Promise<void> {
    // D1 bindings are managed by the Workers runtime.
  }
}
