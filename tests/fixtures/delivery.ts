import { resolveFixtureRouteDeliveryPolicy } from "../../src/route-delivery/policy.ts";
import type { ApiRecommendedRoute } from "../../src/server-api/contracts.ts";

export const DELIVERY_TEST_ROUTE: ApiRecommendedRoute = {
  id: "route-delivery-1",
  candidateId: "candidate-1",
  geometry: {
    type: "LineString",
    coordinates: [
      [120.148, 30.244],
      [120.153, 30.25],
      [120.148, 30.244],
    ],
  },
  distanceMeters: 5_120,
  durationSeconds: 1_800,
  directionDegrees: 45,
  source: {
    providerId: "fake-route",
    externalId: "fixture-1",
  },
  scenicFeatures: {
    availability: "available",
    greenCoverage: null,
    waterfrontProximity: null,
    builtUpExposure: null,
    roadComfort: null,
  },
  score: {
    total: 82.5,
    dimensions: {
      distanceFit: 96,
      greenery: 80,
      waterfront: 70,
      lowTraffic: 75,
      comfort: 0,
    },
    penalties: {
      excessiveDetour: 4,
      builtUpExposure: 2,
    },
    policyId: "ScenicScoreV1",
    policyVersion: "1",
    reasons: [],
  },
  delivery: resolveFixtureRouteDeliveryPolicy("fake-route"),
};
