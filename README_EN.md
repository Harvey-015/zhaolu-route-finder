# Zhaolu

[中文](README.md) | **English**

Zhaolu is a scenic route recommendation project for running and cycling.

Rather than rebuilding a low-level routing engine, the project works on top of real, traversable road networks provided by map services. It combines environmental features, user preferences, and route diversity to recommend routes that better match the target distance while offering more scenic surroundings.

[![CI](https://github.com/Harvey-015/zhaolu-route-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/Harvey-015/zhaolu-route-finder/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Live Demo

[Open the public Cloudflare demo](https://zhaolu-route-finder.wuchunkai55.workers.dev)

[![Zhaolu route planner showcase](docs/images/route-planner-showcase.png)](https://zhaolu-route-finder.wuchunkai55.workers.dev)

The demo currently prioritizes place ranking for the Jingdezhen area by default, while still allowing searches in other cities. Route planning, satellite basemaps, and environmental data are subject to the availability, quotas, and licensing terms of AMap and ESA WorldCover.

## Current Status

The repository now provides a complete route recommendation pipeline that can be run, tested, and deployed:

- map-provider-independent models for places, routes, environmental features, and scoring;
- explicit WGS-84 and GCJ-02 type boundaries;
- the `findScenicRoutes` application use case;
- replaceable ports for place lookup, routing, scenery analysis, and scoring;
- replaceable pure strategies for candidate generation, scoring, and route selection, plus a versioned algorithm-profile registry;
- Fake Providers and fully offline core tests;
- call budgets, concurrency control, cancellation, degradation, and stable error contracts;
- AMap place lookup and walking/cycling route adapters;
- AMap DTOs, runtime validation, and internal-model mappers;
- centralized GCJ-02/WGS-84 conversion;
- centralized timeout handling, bounded retries, cancellation, quota handling, and error translation;
- waypoint segment splitting, request caps, and route merging;
- offline AMap contract tests and controlled online smoke tests;
- an ESA WorldCover COG environmental-feature adapter with controlled online smoke tests;
- a versioned Server API, OpenAPI specification, health checks, and local HTTP smoke tests;
- a React Web UI with current-location support, up to three required waypoints, route constraints, and result comparison;
- waypoint-aware real-road routing that preserves the user-specified order and re-validates final route geometry within 80 meters of each waypoint;
- target-distance control that prefers ±15% and may relax to at most ±25%; routes outside that boundary are excluded from results;
- local generation of 12 directional candidates; when waypoints are present, online routing capacity and fallback candidates are reserved for north, east, south, and west directions;
- route direction calculated from actual AMap geometry, with environmental preferences influencing both candidate guidance and final scoring;
- injectable `BasemapRenderer` support and a standalone `MapLayerProvider` registry;
- AMap JS API 2.0 with satellite + road overlay by default, standard-map switching, a server-side security-key proxy, and an SVG fallback when no key is available;
- desktop and mobile browser acceptance coverage;
- registry-based `RouteExporter` and `NavigationLinkProvider` implementations, including GPX, GeoJSON, and AMap URI delivery controlled by provider policy;
- provider-policy-controlled route persistence and expiration strategies;
- anonymous signed sessions, replaceable user-data ports, SQLite/D1 favorites, and field feedback;
- shared search criteria and replanning based on actual route distance;
- a single-process production runtime, Docker/Compose support, and GitHub Actions;
- startup configuration validation, rate limiting, probes, metrics, redacted logging, and graceful shutdown;
- SQLite online backup, automated restore verification, and Prometheus alerting rules;
- multi-city live-network acceptance checks, controlled load tests, static secret scanning, and production dependency auditing;
- a complete automated test suite covering the core, providers, API, persistence, and Web client (currently 135 tests).

Server-side API keys and session-signing secrets are injected only through environment variables; no real secrets are stored in the repository.

The repository supports both Cloudflare Workers + D1 and Node.js + SQLite deployment modes. Public deployments still require the operator to configure domain allowlists, provider secrets, quotas, and compliance information. Real secrets must never be committed to Git.

## Architecture Boundaries

```text
Caller
  ↓
findScenicRoutes
  ├─ PlaceProvider
  ├─ RouteProvider
  ├─ SceneryProvider
  ├─ RouteScoringPolicy
  ├─ CandidateGenerationStrategy
  └─ RouteSelectionStrategy
```

The default product composition uses AMap JS API for map rendering, AMap satellite/standard basemaps, AMap POI and route planning, ESA WorldCover for environmental analysis, the `scenic-route@2` recommendation algorithm, and AMap for navigation handoff.

The map renderer, visible basemap/reference layers, place and road providers, environmental-data provider, recommendation-algorithm profile, and route-delivery provider are all registered at the composition root. Each can be replaced independently without modifying the routing core or adding page-level conditional branches.

The core depends only on internal TypeScript models. It has no dependency on React, Next.js, Cloudflare, databases, or third-party map SDKs.

AMap infrastructure code lives under `src/adapters/amap`, where it implements `PlaceProvider`, `RouteProvider`, and AMap navigation handoff. These implementations do not leak back into the route core.

For the full design, see the [Architecture documentation](docs/ARCHITECTURE.md).

For local Web development, see the [Web UI documentation](docs/WEB_UI.md). For the Server API, see the [Server API documentation](docs/SERVER_API.md). Route delivery and data policy are documented in [Route Delivery](docs/ROUTE_DELIVERY.md). Provider authorization gates are recorded in [Provider Compliance](docs/PROVIDER_COMPLIANCE.md). Production runtime details are covered in [Deployment](docs/DEPLOYMENT.md). Live staging acceptance is covered in [Staging](docs/STAGING.md). Privacy, terms, and data rights are documented in [Privacy and Terms](docs/PRIVACY_AND_TERMS.md). Monitoring, alerting, and recovery are covered in [Operations](docs/OPERATIONS.md). Release quality gates are documented in [Release Gates](docs/RELEASE_GATES.md), and the final Go/No-Go process is in the [Launch Checklist](docs/LAUNCH_CHECKLIST.md).

## Development Commands

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm exec playwright install chromium
pnpm run test:e2e
```

`test:e2e` starts a local fixture API and Vite, then uses Chromium to validate the main route-generation, favorite, and refresh-recovery flows. CI installs the required browser automatically.

## Running the Full Version Locally

After preparing an AMap key and a session secret of at least 32 characters in `.env`, run the following in PowerShell:

```powershell
pnpm run build
$env:ZHAOLU_PUBLIC_ORIGIN = "http://127.0.0.1:8787"
node --env-file=.env dist/runtime/main.js
```

Then open `http://127.0.0.1:8787`. This endpoint serves the Web UI, Server API, and AMap security proxy together, so you are testing the complete route algorithm rather than a static UI preview.

For public deployment with Cloudflare Workers + D1 and secret configuration, see the [Cloudflare deployment guide](docs/CLOUDFLARE_DEPLOYMENT.md).

## Contributing

Bug fixes, tests, documentation improvements, and new map, routing, environmental-data, and recommendation-algorithm implementations are welcome. Before contributing, please read:

- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support Policy](SUPPORT.md)
- [Project Governance](GOVERNANCE.md)
- [Public Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Open Source Release Checklist](docs/OPEN_SOURCE_RELEASE.md)
- [Cloudflare Workers + D1 Demo Deployment (R2 optional)](docs/CLOUDFLARE_DEPLOYMENT.md)

When adding new capabilities, keep the existing decoupling boundaries intact: third-party DTOs, SDKs, and network calls stay in adapters; the core depends only on internal models and ports; providers, map layers, and algorithm profiles are integrated through the composition root or registries.

For larger extensions, use the repository's Provider issue template first to discuss coordinate systems, licensing, quotas, caching, and degradation strategies.

## License

This project is licensed under the [Apache License 2.0](LICENSE). Third-party maps, satellite imagery, routing services, and environmental datasets remain subject to their respective provider terms and data licenses; the source-code license does not replace those permissions.
