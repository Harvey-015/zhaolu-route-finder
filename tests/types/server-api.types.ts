import type { FindScenicRoutesResult } from "../../src/route-recommendation/models.ts";
import type { PlanRoutesApiRequest } from "../../src/server-api/contracts.ts";
import {
  createServerApi,
  type PlanScenicRoutes,
  type ServerApiHandler,
} from "../../src/server-api/handler.ts";

const planRoutes: PlanScenicRoutes = async (
  _request,
  _signal,
): Promise<FindScenicRoutesResult> => {
  throw new Error("Type-only contract");
};
const handler: ServerApiHandler = createServerApi({ planRoutes });

const request: PlanRoutesApiRequest = {
  schemaVersion: "1",
  start: {
    kind: "point",
    longitude: 120.145,
    latitude: 30.26,
    crs: "WGS84",
  },
  mode: "running",
  targetDistanceMeters: 5_000,
  preferences: {
    greenery: 1,
    waterfront: 1,
    lowTraffic: 1,
    comfort: 1,
  },
};

const invalidCoordinateRequest: PlanRoutesApiRequest = {
  ...request,
  start: {
    kind: "point",
    longitude: 120.145,
    latitude: 30.26,
    // @ts-expect-error Public point input must explicitly be WGS84.
    crs: "GCJ02",
  },
};

void [handler, request, invalidCoordinateRequest];
