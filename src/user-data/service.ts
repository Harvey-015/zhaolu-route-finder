import { randomUUID } from "node:crypto";
import type {
  ApiProviderReference,
  ApiRecommendedRoute,
  PlanRoutesApiRequest,
} from "../server-api/contracts.ts";
import {
  apiPlaceInput,
  mapPlanRoutesApiRequest,
} from "../server-api/mappers.ts";
import type {
  RouteDeliveryPolicy,
  RouteDeliveryPolicyResolver,
} from "../route-delivery/policy.ts";
import { RouteRecommendationError } from "../route-recommendation/errors.ts";
import { validateFindScenicRoutesRequest } from "../route-recommendation/findScenicRoutes.ts";
import type {
  FeatureMetric,
  RecommendationReason,
  RouteScore,
  ScenicFeatures,
} from "../route-recommendation/models.ts";
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

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find(
    (key) => !allowedKeys.has(key),
  );
  if (unexpected) {
    throw new UserDataError(
      400,
      "INVALID_REQUEST",
      field === "$" ? unexpected : `${field}.${unexpected}`,
    );
  }
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
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  return value;
}

function readRequest(value: unknown): PlanRoutesApiRequest {
  try {
    const mapped = mapPlanRoutesApiRequest(
      value,
      "saved-route-validation",
    );
    validateFindScenicRoutesRequest(mapped);
    const source = value as Record<string, unknown>;
    return {
      schemaVersion: "1",
      ...(source.requestId === undefined
        ? {}
        : { requestId: mapped.requestId }),
      start: apiPlaceInput(mapped.start),
      mode: readMode(mapped.mode),
      targetDistanceMeters: mapped.targetDistanceMeters,
      preferences: mapped.preferences,
      ...(source.requiredStops === undefined
        ? {}
        : {
            requiredStops: (mapped.requiredStops ?? []).map(
              apiPlaceInput,
            ),
          }),
      ...(mapped.maxResults === undefined
        ? {}
        : { maxResults: mapped.maxResults }),
    };
  } catch (error) {
    if (error instanceof UserDataError) throw error;
    const field =
      error instanceof RouteRecommendationError &&
      typeof error.details?.field === "string"
        ? `request.${error.details.field}`
        : "request";
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
}

function readProviderReference(
  value: unknown,
  field: string,
): ApiProviderReference {
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  assertOnlyKeys(value, ["providerId", "externalId"], field);
  return {
    providerId: requireString(
      value.providerId,
      `${field}.providerId`,
      100,
    ),
    ...(value.externalId === undefined
      ? {}
      : {
          externalId: requireString(
            value.externalId,
            `${field}.externalId`,
            200,
          ),
        }),
  };
}

function readMetric(
  value: unknown,
  field: string,
): FeatureMetric | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  assertOnlyKeys(
    value,
    ["value", "confidence", "source", "sourceVersion"],
    field,
  );
  return {
    value: readFiniteNumber(value.value, `${field}.value`, 0, 1),
    confidence: readFiniteNumber(
      value.confidence,
      `${field}.confidence`,
      0,
      1,
    ),
    source: readProviderReference(value.source, `${field}.source`),
    ...(value.sourceVersion === undefined
      ? {}
      : {
          sourceVersion: requireString(
            value.sourceVersion,
            `${field}.sourceVersion`,
            100,
          ),
        }),
  };
}

function readScenicFeatures(value: unknown): ScenicFeatures {
  const field = "route.scenicFeatures";
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  assertOnlyKeys(
    value,
    [
      "availability",
      "greenCoverage",
      "waterfrontProximity",
      "builtUpExposure",
      "roadComfort",
    ],
    field,
  );
  if (
    value.availability !== "available" &&
    value.availability !== "partial" &&
    value.availability !== "unavailable"
  ) {
    throw new UserDataError(
      400,
      "INVALID_REQUEST",
      `${field}.availability`,
    );
  }
  return {
    availability: value.availability,
    greenCoverage: readMetric(
      value.greenCoverage,
      `${field}.greenCoverage`,
    ),
    waterfrontProximity: readMetric(
      value.waterfrontProximity,
      `${field}.waterfrontProximity`,
    ),
    builtUpExposure: readMetric(
      value.builtUpExposure,
      `${field}.builtUpExposure`,
    ),
    roadComfort: readMetric(
      value.roadComfort,
      `${field}.roadComfort`,
    ),
  };
}

function readScoreRecord(
  value: unknown,
  field: string,
  keys: readonly string[],
): Record<string, number> {
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  assertOnlyKeys(value, keys, field);
  const result: Record<string, number> = {};
  keys.forEach((key) => {
    result[key] = readFiniteNumber(
      value[key],
      `${field}.${key}`,
      0,
      100,
    );
  });
  return result;
}

function readReasons(value: unknown): readonly RecommendationReason[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new UserDataError(400, "INVALID_REQUEST", "route.score.reasons");
  }
  return value.map((item, index) => {
    const field = `route.score.reasons.${index}`;
    if (!isRecord(item)) {
      throw new UserDataError(400, "INVALID_REQUEST", field);
    }
    assertOnlyKeys(item, ["code", "params", "contribution"], field);
    if (
      item.code !== "DISTANCE_FIT" &&
      item.code !== "GREENERY" &&
      item.code !== "WATERFRONT"
    ) {
      throw new UserDataError(400, "INVALID_REQUEST", `${field}.code`);
    }
    let params: Record<string, string | number> | undefined;
    if (item.params !== undefined) {
      if (!isRecord(item.params) || Object.keys(item.params).length > 20) {
        throw new UserDataError(400, "INVALID_REQUEST", `${field}.params`);
      }
      params = {};
      Object.entries(item.params).forEach(([key, parameter]) => {
        if (typeof parameter === "string") {
          params![key] = requireString(
            parameter,
            `${field}.params.${key}`,
            200,
          );
        } else {
          params![key] = readFiniteNumber(
            parameter,
            `${field}.params.${key}`,
          );
        }
      });
    }
    return {
      code: item.code,
      ...(params ? { params } : {}),
      contribution: readFiniteNumber(
        item.contribution,
        `${field}.contribution`,
        0,
        100,
      ),
    };
  });
}

function readScore(value: unknown): RouteScore {
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", "route.score");
  }
  assertOnlyKeys(
    value,
    [
      "total",
      "dimensions",
      "penalties",
      "policyId",
      "policyVersion",
      "reasons",
    ],
    "route.score",
  );
  const dimensions = readScoreRecord(
    value.dimensions,
    "route.score.dimensions",
    ["distanceFit", "greenery", "waterfront", "lowTraffic", "comfort"],
  );
  const penalties = readScoreRecord(
    value.penalties,
    "route.score.penalties",
    ["excessiveDetour", "builtUpExposure"],
  );
  return {
    total: readFiniteNumber(value.total, "route.score.total", 0, 100),
    dimensions: dimensions as RouteScore["dimensions"],
    penalties: penalties as RouteScore["penalties"],
    policyId: requireString(value.policyId, "route.score.policyId", 100),
    policyVersion: requireString(
      value.policyVersion,
      "route.score.policyVersion",
      100,
    ),
    reasons: readReasons(value.reasons),
  };
}

function readStringArray(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  const result = value.map((item, index) =>
    requireString(item, `${field}.${index}`, 100),
  );
  if (new Set(result).size !== result.length) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  return result;
}

function readDelivery(
  value: unknown,
): ApiRecommendedRoute["delivery"] {
  const field = "route.delivery";
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", field);
  }
  assertOnlyKeys(
    value,
    [
      "policyId",
      "policyVersion",
      "exportFormats",
      "navigationTargets",
      "persistence",
      "expiresAfterSeconds",
    ],
    field,
  );
  if (
    value.persistence !== "allowed" &&
    value.persistence !== "metadata-only" &&
    value.persistence !== "denied"
  ) {
    throw new UserDataError(
      400,
      "INVALID_REQUEST",
      `${field}.persistence`,
    );
  }
  const expiresAfterSeconds = readFiniteNumber(
    value.expiresAfterSeconds,
    `${field}.expiresAfterSeconds`,
    0,
    365 * 24 * 60 * 60,
  );
  if (!Number.isInteger(expiresAfterSeconds)) {
    throw new UserDataError(
      400,
      "INVALID_REQUEST",
      `${field}.expiresAfterSeconds`,
    );
  }
  return {
    policyId: requireString(value.policyId, `${field}.policyId`, 100),
    policyVersion: requireString(
      value.policyVersion,
      `${field}.policyVersion`,
      100,
    ),
    exportFormats: readStringArray(
      value.exportFormats,
      `${field}.exportFormats`,
    ),
    navigationTargets: readStringArray(
      value.navigationTargets,
      `${field}.navigationTargets`,
    ),
    persistence: value.persistence,
    expiresAfterSeconds,
  };
}

function readRoute(value: unknown): ApiRecommendedRoute {
  if (!isRecord(value)) {
    throw new UserDataError(400, "INVALID_REQUEST", "route");
  }
  assertOnlyKeys(
    value,
    [
      "id",
      "candidateId",
      "geometry",
      "distanceMeters",
      "durationSeconds",
      "directionDegrees",
      "source",
      "scenicFeatures",
      "score",
      "delivery",
    ],
    "route",
  );
  if (!isRecord(value.geometry)) {
    throw new UserDataError(400, "INVALID_REQUEST", "route.geometry");
  }
  assertOnlyKeys(value.geometry, ["type", "coordinates"], "route.geometry");
  if (
    value.geometry.type !== "LineString" ||
    !Array.isArray(value.geometry.coordinates) ||
    value.geometry.coordinates.length < 2 ||
    value.geometry.coordinates.length > 100_000
  ) {
    throw new UserDataError(400, "INVALID_REQUEST", "route.geometry");
  }
  const coordinates = value.geometry.coordinates.map((coordinate, index) => {
    const field = `route.geometry.coordinates.${index}`;
    if (!Array.isArray(coordinate) || coordinate.length !== 2) {
      throw new UserDataError(400, "INVALID_REQUEST", field);
    }
    return [
      readFiniteNumber(coordinate[0], `${field}.0`, -180, 180),
      readFiniteNumber(coordinate[1], `${field}.1`, -90, 90),
    ] as const;
  });
  const durationSeconds =
    value.durationSeconds === null
      ? null
      : readFiniteNumber(
          value.durationSeconds,
          "route.durationSeconds",
          0,
          30 * 24 * 60 * 60,
        );
  return {
    id: requireString(value.id, "route.id", 200),
    candidateId: requireString(
      value.candidateId,
      "route.candidateId",
      200,
    ),
    geometry: { type: "LineString", coordinates },
    distanceMeters: readFiniteNumber(
      value.distanceMeters,
      "route.distanceMeters",
      Number.EPSILON,
      1_000_000,
    ),
    durationSeconds,
    directionDegrees: readFiniteNumber(
      value.directionDegrees,
      "route.directionDegrees",
      0,
      360,
    ),
    source: readProviderReference(value.source, "route.source"),
    scenicFeatures: readScenicFeatures(value.scenicFeatures),
    score: readScore(value.score),
    delivery: readDelivery(value.delivery),
  };
}

function assertPolicySnapshot(
  actual: ApiRecommendedRoute["delivery"],
  expected: RouteDeliveryPolicy,
): void {
  if (
    actual.policyId !== expected.policyId ||
    actual.policyVersion !== expected.policyVersion ||
    actual.persistence !== expected.persistence ||
    actual.expiresAfterSeconds !== expected.expiresAfterSeconds ||
    actual.exportFormats.join("\0") !== expected.exportFormats.join("\0") ||
    actual.navigationTargets.join("\0") !==
      expected.navigationTargets.join("\0")
  ) {
    throw new UserDataError(
      400,
      "INVALID_REQUEST",
      "route.delivery",
    );
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization);
  if (!match) throw new UserDataError(401, "UNAUTHORIZED");
  return match[1];
}

function readIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  const key = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw new UserDataError(
      400,
      "INVALID_REQUEST",
      "idempotency-key",
    );
  }
  return key;
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
    idempotencyKeyValue?: string,
  ): SavedRouteSummary {
    if (!isRecord(value) || value.schemaVersion !== "1") {
      throw new UserDataError(400, "INVALID_REQUEST", "$");
    }
    assertOnlyKeys(
      value,
      ["schemaVersion", "name", "request", "route"],
      "$",
    );
    const name = requireString(value.name, "name", 100);
    const request = readRequest(value.request);
    const route = readRoute(value.route);
    const policy = this.policyResolver(route.source.providerId);
    assertPolicySnapshot(route.delivery, policy);
    if (policy.persistence === "denied") {
      throw new UserDataError(
        403,
        "PROVIDER_PERSISTENCE_DENIED",
      );
    }
    const now = this.now();
    const idempotencyKey = readIdempotencyKey(
      idempotencyKeyValue,
    );
    if (idempotencyKey) {
      const existing = this.store.findSavedRouteByIdempotencyKey(
        userId,
        idempotencyKey,
        now,
      );
      if (existing) return existing;
    }
    const record: SavedRouteRecord = {
      id: randomUUID(),
      userId,
      idempotencyKey,
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
