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

function polylineDistance(points: readonly Wgs84Point[]): number {
  return points.slice(1).reduce(
    (total, point, index) =>
      total + distanceMeters(points[index], point),
    0,
  );
}

function selectAnchor(
  origin: Wgs84Point,
  targetDistanceMeters: number,
  direction: number,
  anchors: readonly ScenicAnchor[],
  usedAnchorIds: Set<string>,
) {
  const idealDistance = targetDistanceMeters / 5.1;
  return [...anchors]
    .map((anchor, rank) => ({ anchor, rank }))
    .filter(({ anchor }) => !usedAnchorIds.has(anchor.id))
    .map(({ anchor, rank }) => ({
      anchor,
      score:
        (angularDifference(
          direction,
          bearingDegrees(origin, anchor.point),
        ) /
          180) *
          0.45 +
        Math.min(
          2,
          Math.abs(distanceMeters(origin, anchor.point) - idealDistance) /
            Math.max(idealDistance, 1),
        ) *
          0.35 +
        (rank / Math.max(1, anchors.length - 1)) * 0.2,
    }))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.anchor.id.localeCompare(right.anchor.id),
    )[0]?.anchor;
}

function waypointOrderForTarget(
  origin: Wgs84Point,
  requiredStops: readonly Wgs84Point[],
  targetDistanceMeters: number,
  direction: number,
  scenicAnchor?: ScenicAnchor,
): Readonly<{
  waypoints: readonly Wgs84Point[];
  estimatedRoadDistance: number;
}> {
  const basePoints = [origin, ...requiredStops, origin];
  const mandatoryLoopDistance = polylineDistance([
    origin,
    ...requiredStops,
    origin,
  ]);
  if (mandatoryLoopDistance >= targetDistanceMeters * 0.9) {
    return {
      waypoints: requiredStops,
      estimatedRoadDistance: mandatoryLoopDistance * 1.18,
    };
  }

  const calibratedRadius = Math.max(500, targetDistanceMeters / 5.1);
  const sampleCount = 18;
  let best:
    | Readonly<{
        waypoints: readonly Wgs84Point[];
        estimatedRoadDistance: number;
        difference: number;
      }>
    | undefined;

  for (let index = 0; index < sampleCount; index += 1) {
    const radiusFactor = 0.55 + (index / (sampleCount - 1)) * 0.9;
    const radius = calibratedRadius * radiusFactor;
    const halfSweep = 42;
    const firstGuidancePoint = scenicAnchor?.point ??
      destinationPoint(origin, radius, direction - halfSweep);
    const scenicOffset = scenicAnchor
      ? ((bearingDegrees(origin, scenicAnchor.point) - direction + 540) %
          360) -
        180
      : -halfSweep;
    const secondGuidancePoint = destinationPoint(
      origin,
      radius,
      direction + (scenicOffset <= 0 ? halfSweep : -halfSweep),
    );
    const orders = [
      [firstGuidancePoint, secondGuidancePoint],
      [secondGuidancePoint, firstGuidancePoint],
    ] as const;

    for (const [first, second] of orders) {
      for (let gap = 0; gap < basePoints.length - 1; gap += 1) {
        const points = [
          ...basePoints.slice(0, gap + 1),
          first,
          second,
          ...basePoints.slice(gap + 1),
        ];
        const estimatedRoadDistance = polylineDistance(points) * 1.18;
        const difference = Math.abs(
          estimatedRoadDistance - targetDistanceMeters,
        );
        if (!best || difference < best.difference) {
          best = {
            waypoints: points.slice(1, -1),
            estimatedRoadDistance,
            difference,
          };
        }
      }
    }
  }

  return (
    best ?? {
      waypoints: requiredStops,
      estimatedRoadDistance: mandatoryLoopDistance * 1.18,
    }
  );
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
  const usedAnchorIds = new Set<string>();
  const requiredStopPoints = requiredStops.map(({ point }) => point);

  return Array.from({ length: candidateCount }, (_, index) => {
    const direction = (index * 360) / candidateCount;
    const scenicAnchor = selectAnchor(
      origin,
      targetDistanceMeters,
      direction,
      scenicAnchors,
      usedAnchorIds,
    );
    const generatedOrder = waypointOrderForTarget(
      origin,
      requiredStopPoints,
      targetDistanceMeters,
      direction,
    );
    const scenicOrder = scenicAnchor
      ? waypointOrderForTarget(
          origin,
          requiredStopPoints,
          targetDistanceMeters,
          direction,
          scenicAnchor,
        )
      : undefined;
    const generatedDifference = Math.abs(
      generatedOrder.estimatedRoadDistance - targetDistanceMeters,
    );
    const scenicDifference = Math.abs(
      (scenicOrder?.estimatedRoadDistance ?? Number.POSITIVE_INFINITY) -
        targetDistanceMeters,
    );
    const useScenicAnchor =
      scenicAnchor !== undefined &&
      scenicOrder !== undefined &&
      scenicDifference <=
        generatedDifference + targetDistanceMeters * 0.06;
    if (useScenicAnchor) usedAnchorIds.add(scenicAnchor.id);
    const waypoints = useScenicAnchor
      ? scenicOrder.waypoints
      : generatedOrder.waypoints;

    return {
      id: `${requestId}:candidate-${String(index + 1).padStart(2, "0")}`,
      origin,
      destination: origin,
      waypoints,
      requiredStops,
      scenicAnchorIds:
        useScenicAnchor && scenicAnchor ? [scenicAnchor.id] : [],
      directionDegrees: direction,
      targetDistanceMeters,
    };
  });
}
