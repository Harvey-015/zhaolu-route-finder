import type {
  ApiRecommendedRoute,
  PlanRoutesApiRequest,
} from "../server-api/contracts.ts";
import type { RouteDeliveryPolicy } from "../route-delivery/policy.ts";

export type UserSession = Readonly<{
  userId: string;
  expiresAt: number;
}>;

export type SavedRouteSummary = Readonly<{
  id: string;
  name: string;
  mode: "running" | "cycling";
  providerId: string;
  distanceMeters: number;
  durationSeconds: number | null;
  score: number;
  hasGeometry: boolean;
  createdAt: number;
  expiresAt: number;
}>;

export type SavedRouteRecord = SavedRouteSummary &
  Readonly<{
    userId: string;
    idempotencyKey: string | null;
    request: PlanRoutesApiRequest;
    route: ApiRecommendedRoute | null;
    policy: RouteDeliveryPolicy;
  }>;

export type SaveRouteInput = Readonly<{
  name: string;
  request: PlanRoutesApiRequest;
  route: ApiRecommendedRoute;
}>;

export type FieldReport = Readonly<{
  id: string;
  savedRouteId: string;
  userId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  note: string | null;
  createdAt: number;
  expiresAt: number;
}>;

export interface UserDataStore {
  isHealthy(): Promise<boolean>;
  createSession(session: UserSession): Promise<void>;
  hasSession(userId: string, now: number): Promise<boolean>;
  deleteUserData(userId: string): Promise<boolean>;
  saveRoute(record: SavedRouteRecord): Promise<void>;
  findSavedRouteByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    now: number,
  ): Promise<SavedRouteSummary | null>;
  listSavedRoutes(
    userId: string,
    now: number,
  ): Promise<readonly SavedRouteSummary[]>;
  getSavedRoute(
    userId: string,
    routeId: string,
    now: number,
  ): Promise<SavedRouteRecord | null>;
  deleteSavedRoute(userId: string, routeId: string): Promise<boolean>;
  addFieldReport(report: FieldReport): Promise<void>;
  purgeExpired(now: number): Promise<number>;
  close(): Promise<void>;
}
