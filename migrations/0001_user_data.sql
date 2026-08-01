PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_sessions (
  user_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS saved_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('running', 'cycling')),
  provider_id TEXT NOT NULL,
  distance_m REAL NOT NULL,
  duration_s REAL,
  score REAL NOT NULL,
  request_json TEXT NOT NULL,
  route_json TEXT,
  policy_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
    ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS saved_routes_user_created
  ON saved_routes(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS saved_routes_user_idempotency
  ON saved_routes(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS field_reports (
  id TEXT PRIMARY KEY,
  saved_route_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (saved_route_id) REFERENCES saved_routes(id)
    ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user_sessions(user_id)
    ON DELETE CASCADE
) STRICT;
