export type AmapApiEnvelopeDto = Readonly<{
  status: string;
  info: string;
  infocode: string;
}>;

export type AmapGeocodeDto = Readonly<{
  formatted_address?: string;
  country?: string | readonly never[];
  province?: string | readonly never[];
  city?: string | readonly never[];
  citycode?: string | readonly never[];
  district?: string | readonly never[];
  street?: string | readonly never[];
  number?: string | readonly never[];
  adcode?: string;
  location: string;
  level?: string;
}>;

export type AmapGeocodeResponseDto = AmapApiEnvelopeDto &
  Readonly<{
    count: string;
    geocodes: readonly AmapGeocodeDto[];
  }>;

export type AmapPoiDto = Readonly<{
  id?: string;
  name: string;
  address?: string;
  location: string;
  adcode?: string;
}>;

export type AmapPlaceTextResponseDto = AmapApiEnvelopeDto &
  Readonly<{
    count: string;
    pois: readonly AmapPoiDto[];
  }>;

export type AmapRouteCostDto = Readonly<{
  duration?: string;
}>;

export type AmapRouteStepDto = Readonly<{
  instruction?: string;
  orientation?: string;
  road_name?: string;
  step_distance?: string;
  distance?: string;
  cost?: AmapRouteCostDto;
  duration?: string;
  polyline: string;
}>;

export type AmapRoutePathDto = Readonly<{
  distance: string;
  cost?: AmapRouteCostDto;
  duration?: string;
  steps: readonly AmapRouteStepDto[];
}>;

export type AmapRouteResponseDto = AmapApiEnvelopeDto &
  Readonly<{
    count: string;
    route: Readonly<{
      origin: string;
      destination: string;
      paths: readonly AmapRoutePathDto[];
    }>;
  }>;
