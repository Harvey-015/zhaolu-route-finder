import { randomUUID } from "node:crypto";
import type {
  ApiRecommendedRoute,
  PlanRoutesApiRequest,
} from "../server-api/contracts.ts";
import type { RouteDeliveryPolicyResolver } from "../route-delivery/policy.ts";
import { SignedSessionService } from "./auth.ts";
import type {
  FieldReport,
  SavedRouteRecord,
  SavedRouteSummary,
  UserDataStore,
} from "./models.ts";

export class UserDataError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, field?: string) {
    super(code);
    this.name = "UserDataError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  const result = value.trim();
  if (!result || result.length > maximumLength) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  return result;
}

function readMode(
  value: unknown,
): "running" | "cycling" {
  if (value !== "running" && value !== "cycling") {
    throw new UserDataError(400, "INVALID_REQUEST", "request.mode");
  }
  return value;
}

function readFiniteNumber(
  value: unknown,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  return value;
}

function readRequest(value: unknown): PlanRoutesApiRequest {
  if (!isRecord(value) || value.schemaVersion !== "1") {
    throw new UserDataError(400, "INVALID_REQUEST", "request");
  }
  readMode(value.mode);
  return value as PlanRoutesApiRequest;
}

function readRoute(value: unknown): ApiRecommendedRoute {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isRecord(value.source) ||
    typeof value.source.providerId !== "string" ||
    !isRecord(value.geometry) ||
    value.geometry.type !== "LineString" ||
    !Array.isArray(value.geometry.coordinates) ||
    value.geometry.coordinates.length < 2 ||
    !isRecord(value.score)
  ) {
    throw new UserDataError(400, "INVALID_REQUEST", "route");
  }
  readFiniteNumber(value.distanceMeters, "route.distanceMeters");
  readFiniteNumber(value.score.total, "route.score.total");
  return value as ApiRecommendedRoute;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  if (!match) throw new UserDataError(401, "UNAUTHORIZED");
  return match[1];
}

export class UserDataService {
  private readonly store: UserDataStore;
  private readonly sessions: SignedSessionService;
  private readonly policyResolver: RouteDeliveryPolicyResolver;
  private readonly now: () => number;

  constructor(options: Readonly<{
    store: UserDataStore;
    sessions: SignedSessionService;
    policyResolver: RouteDeliveryPolicyResolver;
    now?: () => number;
  }>) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.policyResolver = options.policyResolver;
    this.now = options.now ?? (() => Date.now());
  }

  issueSession(): Readonly<{
    token: string;
    expiresAt: number;
  }> {
    const issued = this.sessions.issue();
    this.store.createSession(issued.session);
    return {
      token: issued.token,
      expiresAt: issued.session.expiresAt,
    };
  }

  authenticate(request: Request): string {
    const session = this.sessions.verify(bearerToken(request));
    if (
      !session ||
      !this.store.hasSession(session.userId, this.now())
    ) {
      throw new UserDataError(401, "UNAUTHORIZED");
    }
    return session.userId;
  }

  saveRoute(
    userId: string,
    value: unknown,
  ): SavedRouteSummary {
    if (!isRecord(value) || value.schemaVersion !== "1") {
      throw new UserDataError(400, "INVALID_REQUEST", "$");
    }
    const name = requireString(value.name, "name", 100);
    const request = readRequest(value.request);
    const route = readRoute(value.route);
    const policy = this.policyResolver(route.source.providerId);
    if (policy.persistence === "denied") {
      throw new UserDataError(
        403,
        "PROVIDER_PERSISTENCE_DENIED",
      );
    }
    const now = this.now();
    const record: SavedRouteRecord = {
      id: randomUUID(),
      userId,
      name,
      mode: request.mode,
      providerId: route.source.providerId,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      score: route.score.total,
      request,
      route:
        policy.persistence === "allowed" ? route : null,
      policy,
      createdAt: now,
      expiresAt: now + policy.expiresAfterSeconds * 1_000,
      hasGeometry: policy.persistence === "allowed",
    };
    this.store.saveRoute(record);
    return record;
  }

  listSavedRoutes(userId: string): readonly SavedRouteSummary[] {
    return this.store.listSavedRoutes(userId, this.now());
  }

  deleteSavedRoute(userId: string, routeId: string): void {
    if (!this.store.deleteSavedRoute(userId, routeId)) {
      throw new UserDataError(404, "SAVED_ROUTE_NOT_FOUND");
    }
  }

  addFieldReport(
    userId: string,
    routeId: string,
    value: unknown,
  ): FieldReport {
    const route = this.store.getSavedRoute(
      userId,
      routeId,
      this.now(),
    );
    if (!route) {
      throw new UserDataError(404, "SAVED_ROUTE_NOT_FOUND");
    }
    if (!isRecord(value) || value.schemaVersion !== "1") {
      throw new UserDataError(400, "INVALID_REQUEST", "$");
    }
    const rating = value.rating;
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      throw new UserDataError(400, "INVALID_REQUEST", "rating");
    }
    const note =
      value.note === undefined || value.note === null
        ? null
        : requireString(value.note, "note", 500);
    const report: FieldReport = {
      id: randomUUID(),
      savedRouteId: route.id,
      userId,
      rating: rating as 1 | 2 | 3 | 4 | 5,
      note,
      createdAt: this.now(),
      expiresAt: route.expiresAt,
    };
    this.store.addFieldReport(report);
    return report;
  }

  purgeExpired(): number {
    return this.store.purgeExpired(this.now());
  }
}
