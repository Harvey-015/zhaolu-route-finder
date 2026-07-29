import {
  gcj02ToWgs84,
  wgs84ToGcj02,
} from "../../src/adapters/amap/coordinates.ts";
import {
  gcj02Point,
  wgs84Point,
} from "../../src/route-recommendation/coordinates.ts";

const wgs84 = wgs84Point(120.149, 30.259);
const gcj02 = gcj02Point(120.153, 30.257);

const acceptedGcj02 = wgs84ToGcj02(wgs84);
const acceptedWgs84 = gcj02ToWgs84(gcj02);

// @ts-expect-error WGS-84 input must be converted before calling AMap.
wgs84ToGcj02(gcj02);
// @ts-expect-error AMap GCJ-02 output must be normalized before entering core.
gcj02ToWgs84(wgs84);

void [acceptedGcj02, acceptedWgs84];
