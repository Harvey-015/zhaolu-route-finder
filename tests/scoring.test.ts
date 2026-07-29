import assert from "node:assert/strict";
import test from "node:test";
import { wgs84Point } from "../src/route-recommendation/coordinates.ts";
import {
  unavailableScenicFeatures,
  type RoutedRoute,
  type ScenicFeatures,
} from "../src/route-recommendation/models.ts";
import { ScenicScoreV1 } from "../src/route-recommendation/scoring.ts";

const route: RoutedRoute = {
  id: "score-route",
  candidateId: "score-candidate",
  geometry: [
    wgs84Point(120.145, 30.26),
    wgs84Point(120.147, 30.262),
  ],
  segments: [],
  distanceMeters: 5_000,
  durationSeconds: 1_800,
  directionDegrees: 45,
  source: { providerId: "fixture-route" },
};
const preferences = {
  greenery: 1,
  waterfront: 1,
  lowTraffic: 1,
  comfort: 1,
} as const;

function metric(value: number) {
  return {
    value,
    confidence: 1,
    source: { providerId: "fixture-scenery" },
  };
}

test("ScenicScoreV1 produces a versioned explainable score", () => {
  const features: ScenicFeatures = {
    availability: "available",
    greenCoverage: metric(0.9),
    waterfrontProximity: metric(0.8),
    builtUpExposure: metric(0.1),
    roadComfort: metric(0.7),
  };

  const score = new ScenicScoreV1().score({
    route,
    scenicFeatures: features,
    preferences,
    targetDistanceMeters: 5_000,
  });

  assert.equal(score.policyId, "scenic-score");
  assert.equal(score.policyVersion, "1");
  assert.ok(score.total > 70 && score.total <= 100);
  assert.deepEqual(
    score.reasons.map(({ code }) => code),
    ["DISTANCE_FIT", "GREENERY", "WATERFRONT"],
  );
});

test("ScenicScoreV1 treats missing scenery as unknown, not NaN", () => {
  const score = new ScenicScoreV1().score({
    route,
    scenicFeatures: unavailableScenicFeatures(),
    preferences,
    targetDistanceMeters: 5_000,
  });

  assert.ok(Number.isFinite(score.total));
  assert.equal(score.dimensions.greenery, 0);
  assert.equal(score.dimensions.waterfront, 0);
  assert.equal(score.dimensions.lowTraffic, 0);
  assert.equal(score.dimensions.comfort, 0);
});
