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
  isHealthy(): boolean;
  createSession(session: UserSession): void;
  hasSession(userId: string, now: number): boolean;
  deleteUserData(userId: string): boolean;
  saveRoute(record: SavedRouteRecord): void;
  findSavedRouteByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    now: number,
  ): SavedRouteSummary | null;
  listSavedRoutes(
    userId: string,
    now: number,
  ): readonly SavedRouteSummary[];
  getSavedRoute(
    userId: string,
    routeId: string,
    now: number,
  ): SavedRouteRecord | null;
  deleteSavedRoute(userId: string, routeId: string): boolean;
  addFieldReport(report: FieldReport): void;
  purgeExpired(now: number): number;
  close(): void;
}
