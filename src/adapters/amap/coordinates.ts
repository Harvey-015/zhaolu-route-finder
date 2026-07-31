import {
  gcj02Point,
  wgs84Point,
  type Gcj02Point,
  type Wgs84Point,
} from "../../route-recommendation/coordinates.ts";

const PI = Math.PI;
const SEMI_MAJOR_AXIS = 6_378_245;
const ECCENTRICITY_SQUARED = 0.006693421622965943;

function isOutsideMainlandChina(
  point: Wgs84Point | Gcj02Point,
): boolean {
  return (
    point.longitude < 72.004 ||
    point.longitude > 137.8347 ||
    point.latitude < 0.8293 ||
    point.latitude > 55.8271
  );
}

function transformLatitude(longitude: number, latitude: number) {
  let result =
    -100 +
    2 * longitude +
    3 * latitude +
    0.2 * latitude ** 2 +
    0.1 * longitude * latitude +
    0.2 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20 * Math.sin(6 * longitude * PI) +
      20 * Math.sin(2 * longitude * PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(latitude * PI) +
      40 * Math.sin((latitude / 3) * PI)) *
      2) /
    3;
  result +=
    ((160 * Math.sin((latitude / 12) * PI) +
      320 * Math.sin((latitude * PI) / 30)) *
      2) /
    3;
  return result;
}

function transformLongitude(longitude: number, latitude: number) {
  let result =
    300 +
    longitude +
    2 * latitude +
    0.1 * longitude ** 2 +
    0.1 * longitude * latitude +
    0.1 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20 * Math.sin(6 * longitude * PI) +
      20 * Math.sin(2 * longitude * PI)) *
      2) /
    3;
  result +=
    ((20 * Math.sin(longitude * PI) +
      40 * Math.sin((longitude / 3) * PI)) *
      2) /
    3;
  result +=
    ((150 * Math.sin((longitude / 12) * PI) +
      300 * Math.sin((longitude / 30) * PI)) *
      2) /
    3;
  return result;
}

function gcjOffset(longitude: number, latitude: number) {
  const longitudeDelta = longitude - 105;
  const latitudeDelta = latitude - 35;
  let transformedLatitude = transformLatitude(
    longitudeDelta,
    latitudeDelta,
  );
  let transformedLongitude = transformLongitude(
    longitudeDelta,
    latitudeDelta,
  );
  const latitudeRadians = (latitude / 180) * PI;
  const magic =
    1 -
    ECCENTRICITY_SQUARED *
      Math.sin(latitudeRadians) *
      Math.sin(latitudeRadians);
  const squareRootMagic = Math.sqrt(magic);

  transformedLatitude =
    (transformedLatitude * 180) /
    (((SEMI_MAJOR_AXIS * (1 - ECCENTRICITY_SQUARED)) /
      (magic * squareRootMagic)) *
      PI);
  transformedLongitude =
    (transformedLongitude * 180) /
    ((SEMI_MAJOR_AXIS / squareRootMagic) *
      Math.cos(latitudeRadians) *
      PI);

  return {
    longitude: transformedLongitude,
    latitude: transformedLatitude,
  };
}

export function wgs84ToGcj02(point: Wgs84Point): Gcj02Point {
  if (isOutsideMainlandChina(point)) {
    return gcj02Point(point.longitude, point.latitude);
  }

  const offset = gcjOffset(point.longitude, point.latitude);
  return gcj02Point(
    point.longitude + offset.longitude,
    point.latitude + offset.latitude,
  );
}

export function gcj02ToWgs84(point: Gcj02Point): Wgs84Point {
  if (isOutsideMainlandChina(point)) {
    return wgs84Point(point.longitude, point.latitude);
  }

  let longitude = point.longitude;
  let latitude = point.latitude;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const projected = wgs84ToGcj02(wgs84Point(longitude, latitude));
    const longitudeError = projected.longitude - point.longitude;
    const latitudeError = projected.latitude - point.latitude;
    longitude -= longitudeError;
    latitude -= latitudeError;

    if (
      Math.abs(longitudeError) < 1e-7 &&
      Math.abs(latitudeError) < 1e-7
    ) {
      break;
    }
  }

  return wgs84Point(longitude, latitude);
}

export function formatGcj02Point(point: Gcj02Point): string {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}
