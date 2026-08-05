import { distanceMeters } from "./coordinates.ts";
import type { RecommendedRoute, RoutedRoute } from "./models.ts";
import type { RouteSelectionInput } from "./strategies.ts";

function sampleGeometry(route: RoutedRoute, maximumPoints = 40) {
  if (route.geometry.length <= maximumPoints) return route.geometry;
  const stride = Math.ceil(route.geometry.length / maximumPoints);
  return route.geometry.filter(
    (_, index) =>
      index % stride === 0 || index === route.geometry.length - 1,
  );
}

export function routeOverlapRatio(
  left: RoutedRoute,
  right: RoutedRoute,
  nearbyMeters = 40,
) {
  const leftPoints = sampleGeometry(left);
  const rightPoints = sampleGeometry(right);
  const [shorter, longer] =
    leftPoints.length <= rightPoints.length
      ? [leftPoints, rightPoints]
      : [rightPoints, leftPoints];
  if (shorter.length === 0) return 0;

  const overlapping = shorter.filter((point) =>
    longer.some(
      (candidate) => distanceMeters(point, candidate) <= nearbyMeters,
    ),
  ).length;
  return overlapping / shorter.length;
}

export function selectDiverseRoutes(
  {
    routes,
    limit,
    maxOverlapRatio,
  }: RouteSelectionInput,
): RecommendedRoute[] {
  if (limit <= 0) return [];

  const ranked = [...routes].sort(
    (left, right) =>
      right.score.total - left.score.total ||
      left.route.id.localeCompare(right.route.id),
  );
  const selected: RecommendedRoute[] = [];

  for (const route of ranked) {
    if (
      selected.some(
        (existing) =>
          routeOverlapRatio(existing.route, route.route) >= maxOverlapRatio,
      )
    ) {
      continue;
    }
    selected.push(route);
    if (selected.length >= limit) break;
  }

  // Keep exact/near-exact duplicates out, but do not return fewer routes only
  // because otherwise valid alternatives share a compulsory approach segment.
  for (const route of ranked) {
    if (selected.length >= limit) break;
    if (selected.includes(route)) continue;
    if (
      selected.some(
        (existing) =>
          routeOverlapRatio(existing.route, route.route) >= 0.98,
      )
    ) {
      continue;
    }
    selected.push(route);
  }

  return selected;
}
