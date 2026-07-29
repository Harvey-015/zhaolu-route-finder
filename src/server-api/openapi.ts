export const SERVER_API_OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "找路 Route Recommendation API",
    version: "1.0.0",
    description:
      "Provider-neutral running and cycling route recommendation API.",
  },
  paths: {
    "/api/v1/health": {
      get: {
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Service process is healthy.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/capabilities": {
      get: {
        operationId: "getCapabilities",
        responses: {
          "200": {
            description: "Supported modes, limits and feature coverage.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CapabilitiesResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        responses: {
          "200": {
            description: "This OpenAPI 3.1 document.",
          },
        },
      },
    },
    "/api/v1/routes/plan": {
      post: {
        operationId: "planScenicRoutes",
        parameters: [
          {
            in: "header",
            name: "x-request-id",
            required: false,
            schema: {
              type: "string",
              maxLength: 128,
              pattern: "^[A-Za-z0-9._:-]+$",
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PlanRoutesRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Complete or partially degraded route result.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PlanRoutesResponse",
                },
              },
            },
          },
          "400": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "404": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "408": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "413": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "415": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "422": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "429": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "500": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "503": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "504": {
            $ref: "#/components/responses/ErrorResponse",
          },
        },
      },
    },
    "/api/v1/session": {
      post: {
        operationId: "createAnonymousSession",
        responses: {
          "201": {
            description: "Anonymous device session.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SessionResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/saved-routes": {
      get: {
        operationId: "listSavedRoutes",
        security: [{ bearerSession: [] }],
        responses: {
          "200": {
            description: "Unexpired routes saved by this session.",
          },
          "401": {
            $ref: "#/components/responses/ErrorResponse",
          },
        },
      },
      post: {
        operationId: "saveRoute",
        security: [{ bearerSession: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/SaveRouteRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Saved route or metadata-only record, according to Provider policy.",
          },
          "400": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "401": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "403": {
            $ref: "#/components/responses/ErrorResponse",
          },
        },
      },
    },
    "/api/v1/saved-routes/{routeId}": {
      delete: {
        operationId: "deleteSavedRoute",
        security: [{ bearerSession: [] }],
        parameters: [
          {
            in: "path",
            name: "routeId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Saved route deleted." },
          "401": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "404": {
            $ref: "#/components/responses/ErrorResponse",
          },
        },
      },
    },
    "/api/v1/saved-routes/{routeId}/feedback": {
      post: {
        operationId: "createFieldReport",
        security: [{ bearerSession: [] }],
        parameters: [
          {
            in: "path",
            name: "routeId",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/FieldReportRequest",
              },
            },
          },
        },
        responses: {
          "201": { description: "Field report saved." },
          "400": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "401": {
            $ref: "#/components/responses/ErrorResponse",
          },
          "404": {
            $ref: "#/components/responses/ErrorResponse",
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerSession: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "zhaolu.v1",
      },
    },
    responses: {
      ErrorResponse: {
        description: "Stable error envelope.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ErrorResponse",
            },
          },
        },
      },
    },
    schemas: {
      QueryPlaceInput: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "query"],
        properties: {
          kind: { const: "query" },
          query: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      PointPlaceInput: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "longitude",
          "latitude",
          "crs",
        ],
        properties: {
          kind: { const: "point" },
          longitude: {
            type: "number",
            minimum: -180,
            maximum: 180,
          },
          latitude: {
            type: "number",
            minimum: -90,
            maximum: 90,
          },
          crs: { const: "WGS84" },
          label: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      PlaceInput: {
        oneOf: [
          { $ref: "#/components/schemas/QueryPlaceInput" },
          { $ref: "#/components/schemas/PointPlaceInput" },
        ],
      },
      Preferences: {
        type: "object",
        additionalProperties: false,
        required: [
          "greenery",
          "waterfront",
          "lowTraffic",
          "comfort",
        ],
        properties: {
          greenery: { type: "number", minimum: 0, maximum: 1 },
          waterfront: { type: "number", minimum: 0, maximum: 1 },
          lowTraffic: { type: "number", minimum: 0, maximum: 1 },
          comfort: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      PlanRoutesRequest: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "start",
          "mode",
          "targetDistanceMeters",
          "preferences",
        ],
        properties: {
          schemaVersion: { const: "1" },
          requestId: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9._:-]+$",
          },
          start: { $ref: "#/components/schemas/PlaceInput" },
          mode: { enum: ["running", "cycling"] },
          targetDistanceMeters: {
            type: "number",
            minimum: 500,
            maximum: 200000,
          },
          preferences: {
            $ref: "#/components/schemas/Preferences",
          },
          requiredStops: {
            type: "array",
            maxItems: 3,
            items: { $ref: "#/components/schemas/PlaceInput" },
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 5,
          },
        },
      },
      ProviderReference: {
        type: "object",
        required: ["providerId"],
        properties: {
          providerId: { type: "string" },
          externalId: { type: "string" },
        },
      },
      PointGeometry: {
        type: "object",
        additionalProperties: false,
        required: ["type", "coordinates"],
        properties: {
          type: { const: "Point" },
          coordinates: {
            type: "array",
            prefixItems: [
              { type: "number", minimum: -180, maximum: 180 },
              { type: "number", minimum: -90, maximum: 90 },
            ],
            minItems: 2,
            maxItems: 2,
          },
        },
      },
      LineStringGeometry: {
        type: "object",
        additionalProperties: false,
        required: ["type", "coordinates"],
        properties: {
          type: { const: "LineString" },
          coordinates: {
            type: "array",
            minItems: 2,
            items: {
              type: "array",
              prefixItems: [
                { type: "number", minimum: -180, maximum: 180 },
                { type: "number", minimum: -90, maximum: 90 },
              ],
              minItems: 2,
              maxItems: 2,
            },
          },
        },
      },
      Metric: {
        type: ["object", "null"],
        required: ["value", "confidence", "source"],
        properties: {
          value: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          source: {
            $ref: "#/components/schemas/ProviderReference",
          },
          sourceVersion: { type: "string" },
        },
      },
      ScenicFeatures: {
        type: "object",
        required: [
          "availability",
          "greenCoverage",
          "waterfrontProximity",
          "builtUpExposure",
          "roadComfort",
        ],
        properties: {
          availability: {
            enum: ["available", "partial", "unavailable"],
          },
          greenCoverage: { $ref: "#/components/schemas/Metric" },
          waterfrontProximity: {
            $ref: "#/components/schemas/Metric",
          },
          builtUpExposure: {
            $ref: "#/components/schemas/Metric",
          },
          roadComfort: { $ref: "#/components/schemas/Metric" },
        },
      },
      RecommendedRoute: {
        type: "object",
        required: [
          "id",
          "candidateId",
          "geometry",
          "distanceMeters",
          "durationSeconds",
          "directionDegrees",
          "source",
          "scenicFeatures",
          "score",
          "delivery",
        ],
        properties: {
          id: { type: "string" },
          candidateId: { type: "string" },
          geometry: {
            $ref: "#/components/schemas/LineStringGeometry",
          },
          distanceMeters: { type: "number", exclusiveMinimum: 0 },
          durationSeconds: {
            type: ["number", "null"],
            minimum: 0,
          },
          directionDegrees: {
            type: "number",
            minimum: 0,
            exclusiveMaximum: 360,
          },
          source: {
            $ref: "#/components/schemas/ProviderReference",
          },
          scenicFeatures: {
            $ref: "#/components/schemas/ScenicFeatures",
          },
          score: {
            type: "object",
            required: [
              "total",
              "dimensions",
              "penalties",
              "policyId",
              "policyVersion",
              "reasons",
            ],
          },
          delivery: {
            type: "object",
            required: [
              "policyId",
              "policyVersion",
              "exportFormats",
              "navigationTargets",
              "persistence",
              "expiresAfterSeconds",
            ],
            properties: {
              policyId: { type: "string" },
              policyVersion: { type: "string" },
              exportFormats: {
                type: "array",
                items: { enum: ["geojson", "gpx"] },
              },
              navigationTargets: {
                type: "array",
                items: { const: "amap" },
              },
              persistence: {
                enum: ["allowed", "metadata-only", "denied"],
              },
              expiresAfterSeconds: {
                type: "integer",
                minimum: 0,
              },
            },
          },
        },
      },
      SaveRouteRequest: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "name",
          "request",
          "route",
        ],
        properties: {
          schemaVersion: { const: "1" },
          name: {
            type: "string",
            minLength: 1,
            maxLength: 100,
          },
          request: {
            $ref: "#/components/schemas/PlanRoutesRequest",
          },
          route: {
            $ref: "#/components/schemas/RecommendedRoute",
          },
        },
      },
      FieldReportRequest: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "rating"],
        properties: {
          schemaVersion: { const: "1" },
          rating: {
            type: "integer",
            minimum: 1,
            maximum: 5,
          },
          note: {
            type: "string",
            minLength: 1,
            maxLength: 500,
          },
        },
      },
      SessionResponse: {
        type: "object",
        required: ["schemaVersion", "requestId", "session"],
        properties: {
          schemaVersion: { const: "1" },
          requestId: { type: "string" },
          session: {
            type: "object",
            required: ["token", "expiresAt"],
            properties: {
              token: { type: "string" },
              expiresAt: { type: "integer" },
            },
          },
        },
      },
      PlanRoutesResponse: {
        type: "object",
        required: [
          "schemaVersion",
          "requestId",
          "status",
          "start",
          "requiredStops",
          "routes",
          "warnings",
          "diagnostics",
        ],
        properties: {
          schemaVersion: { const: "1" },
          requestId: { type: "string" },
          status: { enum: ["complete", "partial"] },
          start: {
            type: "object",
            required: ["id", "name", "point", "source"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              point: {
                $ref: "#/components/schemas/PointGeometry",
              },
              source: {
                $ref: "#/components/schemas/ProviderReference",
              },
            },
          },
          requiredStops: { type: "array" },
          routes: {
            type: "array",
            items: {
              $ref: "#/components/schemas/RecommendedRoute",
            },
          },
          warnings: { type: "array" },
          diagnostics: { type: "object" },
        },
      },
      HealthResponse: {
        type: "object",
        required: ["schemaVersion", "service", "status"],
        properties: {
          schemaVersion: { const: "1" },
          service: { const: "zhaolu-route-finder" },
          status: { const: "ok" },
        },
      },
      CapabilitiesResponse: {
        type: "object",
        required: [
          "schemaVersion",
          "apiVersion",
          "modes",
          "coordinateReferenceSystem",
          "geometryFormat",
          "limits",
          "scenicFeatures",
          "openApiDocument",
          "routeDelivery",
        ],
        properties: {
          schemaVersion: { const: "1" },
          apiVersion: { const: "v1" },
          modes: {
            type: "array",
            items: { enum: ["running", "cycling"] },
          },
          coordinateReferenceSystem: { const: "WGS84" },
          geometryFormat: { const: "GeoJSON" },
          limits: { type: "object" },
          scenicFeatures: { type: "object" },
          openApiDocument: { const: "/api/v1/openapi.json" },
          routeDelivery: { type: "object" },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["schemaVersion", "requestId", "error"],
        properties: {
          schemaVersion: { const: "1" },
          requestId: { type: "string" },
          error: {
            type: "object",
            required: ["code", "retryable"],
            properties: {
              code: { type: "string" },
              retryable: { type: "boolean" },
              details: { type: "object" },
            },
          },
        },
      },
    },
  },
} as const;
