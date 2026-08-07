# Codex Development Rules

- Handle one primary subsystem per task. Read only its relevant source, public interfaces, and nearest tests.
- Start with path-scoped `rg` and review with path-specific diffs. Do not print entire lockfiles, build artifacts, large logs, or full Provider responses.
- Do not make unrelated refactors, formatting changes, renames, or dependency upgrades.
- Use the matching `verify:<subsystem>` for the development loop and run `verify:full` before merge. Never claim an unrun check passed.
- `verify:full` covers the full local typecheck, Core/Web build, and the existing Node test list. It does not run security/audit gates, Playwright, Docker/container checks, deployments, or remote workflows, and is not equivalent to all GitHub Actions.
- Local scoped or full verification does not replace required merge CI.
- Online Provider smoke tests, deployments, remote migrations, and real-quota operations require explicit instructions.

Scoped names are `route-core`, `amap`, `worldcover`, `server-api`, `web-unit`, `user-data`, and `cloudflare`. Each has `typecheck:*`, `test:*`, and `verify:*` commands.

The `cloudflare` scope covers `bindings.ts`, the D1/R2 adapters, and their adapter test. It does not cover `src/cloudflare/worker.ts`; use the full typecheck when the Worker may be affected.

Changes to these public contracts, or similar shared interfaces, require at least the full `typecheck` and the full `test` when their runtime consumers may be affected:

- `src/server-api/contracts.ts`
- `src/route-recommendation/models.ts`
- `src/route-recommendation/ports.ts`
- `src/route-recommendation/strategies.ts`
- `src/route-delivery/ports.ts`
- `src/user-data/models.ts`
