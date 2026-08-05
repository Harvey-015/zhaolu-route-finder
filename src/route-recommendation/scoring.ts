import type {
  RecommendationReason,
  RoutePreferences,
  RouteScore,
  RoutedRoute,
  ScenicFeatures,
} from "./models.ts";
import type { RouteScoringPolicy } from "./ports.ts";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function metricPercent(
  value: number | undefined,
  fallback: number,
): number {
  return clamp((value ?? fallback) * 100, 0, 100);
}

export class ScenicScoreV1 implements RouteScoringPolicy {
  readonly id = "scenic-score";
  readonly version = "1";

  score(input: Readonly<{
    route: RoutedRoute;
    scenicFeatures: ScenicFeatures;
    preferences: RoutePreferences;
    targetDistanceMeters: number;
  }>): RouteScore {
    const distanceFit = clamp(
      100 -
        (Math.abs(
          input.route.distanceMeters - input.targetDistanceMeters,
        ) /
          input.targetDistanceMeters) *
          100,
      0,
      100,
    );
    const greenery = metricPercent(
      input.scenicFeatures.greenCoverage?.value,
      0,
    );
    const waterfront = metricPercent(
      input.scenicFeatures.waterfrontProximity?.value,
      0,
    );
    const builtUpExposure = metricPercent(
      input.scenicFeatures.builtUpExposure?.value,
      1,
    );
    const lowTraffic = 100 - builtUpExposure;
    const comfort = metricPercent(
      input.scenicFeatures.roadComfort?.value,
      0,
    );
    const preferenceTotal = Math.max(
      1,
      input.preferences.greenery +
        input.preferences.waterfront +
        input.preferences.lowTraffic +
        input.preferences.comfort,
    );
    const preferenceScore =
      (greenery * input.preferences.greenery +
        waterfront * input.preferences.waterfront +
        lowTraffic * input.preferences.lowTraffic +
        comfort * input.preferences.comfort) /
      preferenceTotal;
    const builtUpPenalty = builtUpExposure * 0.1;
    const total = clamp(
      distanceFit * 0.35 +
        preferenceScore * 0.65 -
        builtUpPenalty,
      0,
      100,
    );
    const reasons: RecommendationReason[] = [];
    if (distanceFit >= 85) {
      reasons.push({
        code: "DISTANCE_FIT",
        contribution: distanceFit,
      });
    }
    if (greenery >= 60) {
      reasons.push({
        code: "GREENERY",
        contribution: greenery,
      });
    }
    if (waterfront >= 60) {
      reasons.push({
        code: "WATERFRONT",
        contribution: waterfront,
      });
    }

    return {
      total,
      dimensions: {
        distanceFit,
        greenery,
        waterfront,
        lowTraffic,
        comfort,
      },
      penalties: {
        excessiveDetour: 100 - distanceFit,
        builtUpExposure: builtUpPenalty,
      },
      policyId: this.id,
      policyVersion: this.version,
      reasons,
    };
  }
}
