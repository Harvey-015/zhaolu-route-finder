# 变更记录

本项目遵循语义化版本。正式发布前的变更记录在 `Unreleased` 下维护。

## Unreleased

### Added

- Provider-neutral scenic route recommendation core and versioned algorithm profiles.
- AMap place, walking/cycling route, satellite basemap and navigation handoff adapters.
- ESA WorldCover scenery adapter with request reuse, bounded caching and partial fallback.
- React route comparison UI, anonymous sessions, favorites and field feedback.
- Container runtime, SQLite backup/restore, Prometheus metrics and release gates.
- Apache-2.0 license and public contribution, security and governance documentation.

### Changed

- Candidate generation now follows requested result count and uses bounded route concurrency.
- Scenery lookup uses soft time budgets so route planning can return partial results.
- The satellite map renders before route completion and fills the complete map panel.

### Security

- AMap JS security code remains server-side behind an allowlisted same-origin proxy.
- Static repository checks reject tracked environment files and common literal secrets.
