export type CoordinateReferenceSystem = "WGS84" | "GCJ02";

export type CoordinatePoint<Crs extends CoordinateReferenceSystem> = Readonly<{
  longitude: number;
  latitude: number;
  crs: Crs;
}>;

export type Wgs84Point = CoordinatePoint<"WGS84">;
export type Gcj02Point = CoordinatePoint<"GCJ02">;

function validateCoordinate(longitude: number, latitude: number) {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new RangeError(
      `Invalid coordinate: longitude=${longitude}, latitude=${latitude}`,
    );
  }
}

export function wgs84Point(
  longitude: number,
  latitude: number,
): Wgs84Point {
  validateCoordinate(longitude, latitude);
  return Object.freeze({ longitude, latitude, crs: "WGS84" as const });
}

export function gcj02Point(
  longitude: number,
  latitude: number,
): Gcj02Point {
  validateCoordinate(longitude, latitude);
  return Object.freeze({ longitude, latitude, crs: "GCJ02" as const });
}

export function distanceMeters(left: Wgs84Point, right: Wgs84Point): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const latitudeLeft = toRadians(left.latitude);
  const latitudeRight = toRadians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeLeft) *
      Math.cos(latitudeRight) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    6_371_000 *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function bearingDegrees(
  origin: Wgs84Point,
  destination: Wgs84Point,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeLeft = toRadians(origin.latitude);
  const latitudeRight = toRadians(destination.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeRight);
  const x =
    Math.cos(latitudeLeft) * Math.sin(latitudeRight) -
    Math.sin(latitudeLeft) *
      Math.cos(latitudeRight) *
      Math.cos(longitudeDelta);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function pathDirectionDegrees(
  origin: Wgs84Point,
  path: readonly Wgs84Point[],
): number {
  if (path.length === 0) return 0;
  const longitudeScale = Math.cos((origin.latitude * Math.PI) / 180);
  const centroid = path.reduce(
    (sum, point) => ({
      east:
        sum.east +
        (point.longitude - origin.longitude) * longitudeScale,
      north: sum.north + point.latitude - origin.latitude,
    }),
    { east: 0, north: 0 },
  );
  if (Math.abs(centroid.east) + Math.abs(centroid.north) < 1e-12) {
    const farthest = [...path].sort(
      (left, right) =>
        distanceMeters(origin, right) - distanceMeters(origin, left),
    )[0];
    return farthest ? bearingDegrees(origin, farthest) : 0;
  }
  return ((Math.atan2(centroid.east, centroid.north) * 180) / Math.PI +
    360) % 360;
}

export function destinationPoint(
  origin: Wgs84Point,
  distance: number,
  bearing: number,
): Wgs84Point {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError(`Invalid distance: ${distance}`);
  }
  if (!Number.isFinite(bearing)) {
    throw new RangeError(`Invalid bearing: ${bearing}`);
  }

  const earthRadius = 6_371_000;
  const angularDistance = distance / earthRadius;
  const bearingRadians = (bearing * Math.PI) / 180;
  const latitude = (origin.latitude * Math.PI) / 180;
  const longitude = (origin.longitude * Math.PI) / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) *
        Math.sin(angularDistance) *
        Math.cos(bearingRadians),
  );
  const destinationLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearingRadians) *
        Math.sin(angularDistance) *
        Math.cos(latitude),
      Math.cos(angularDistance) -
        Math.sin(latitude) * Math.sin(destinationLatitude),
    );

  return wgs84Point(
    ((((destinationLongitude * 180) / Math.PI + 540) % 360) - 180),
    (destinationLatitude * 180) / Math.PI,
  );
}
