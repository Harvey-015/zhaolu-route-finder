import {
  bearingDegrees,
  destinationPoint,
  distanceMeters,
  type Wgs84Point,
} from "./coordinates.ts";
import type {
  RouteCandidate,
  ScenicAnchor,
} from "./models.ts";
import type { CandidateGenerationInput } from "./strategies.ts";

function angularDifference(left: number, right: number) {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

function selectAnchor(
  origin: Wgs84Point,
  targetDistanceMeters: number,
  direction: number,
  anchors: readonly ScenicAnchor[],
  usedAnchorIds: Set<string>,
) {
  const idealDistance = targetDistanceMeters * 0.3;
  return [...anchors]
    .filter((anchor) => !usedAnchorIds.has(anchor.id))
    .map((anchor) => ({
      anchor,
      score:
        angularDifference(
          direction,
          bearingDegrees(origin, anchor.point),
        ) *
          0.5 +
        Math.abs(distanceMeters(origin, anchor.point) - idealDistance) /
          Math.max(idealDistance, 1),
    }))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.anchor.id.localeCompare(right.anchor.id),
    )[0]?.anchor;
}

export function generateDirectionalCandidates({
  requestId,
  origin,
  requiredStops,
  scenicAnchors,
  targetDistanceMeters,
  count,
}: CandidateGenerationInput): RouteCandidate[] {
  const candidateCount = Math.max(1, Math.floor(count));
  const generatedAnchorDistance = Math.max(400, targetDistanceMeters * 0.26);
  const usedAnchorIds = new Set<string>();

  return Array.from({ length: candidateCount }, (_, index) => {
    const direction = (index * 360) / candidateCount;
    const scenicAnchor = selectAnchor(
      origin,
      targetDistanceMeters,
      direction,
      scenicAnchors,
      usedAnchorIds,
    );
    if (scenicAnchor) usedAnchorIds.add(scenicAnchor.id);

    const firstGuidancePoint =
      scenicAnchor?.point ??
      destinationPoint(origin, generatedAnchorDistance, direction - 38);
    const secondGuidancePoint = destinationPoint(
      origin,
      generatedAnchorDistance,
      direction + 38,
    );

    return {
      id: `${requestId}:candidate-${String(index + 1).padStart(2, "0")}`,
      origin,
      destination: origin,
      waypoints: [
        ...requiredStops.map(({ point }) => point),
        firstGuidancePoint,
        secondGuidancePoint,
      ],
      requiredStops,
      scenicAnchorIds: scenicAnchor ? [scenicAnchor.id] : [],
      directionDegrees: direction,
      targetDistanceMeters,
    };
  });
}
