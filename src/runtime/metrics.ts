type MetricKey = `${string}\0${string}\0${number}`;

type MetricValue = {
  count: number;
  durationMs: number;
};

export type BackupMetricStatus = Readonly<{
  createdAt: string;
  restoreVerifiedAt: string;
  sizeBytes: number;
}>;

export function normalizedRoutePath(pathname: string): string {
  if (pathname.startsWith("/assets/")) return "/assets/:asset";
  if (pathname.startsWith("/_AMapService/")) {
    return "/_AMapService/:path";
  }
  if (
    /^\/api\/v1\/saved-routes\/[0-9a-f-]{36}\/feedback$/.test(
      pathname,
    )
  ) {
    return "/api/v1/saved-routes/:routeId/feedback";
  }
  if (
    /^\/api\/v1\/saved-routes\/[0-9a-f-]{36}$/.test(pathname)
  ) {
    return "/api/v1/saved-routes/:routeId";
  }
  const stablePaths = new Set([
    "/",
    "/index.html",
    "/api/v1/capabilities",
    "/api/v1/health",
    "/api/v1/legal-config",
    "/api/v1/map-config",
    "/api/v1/openapi.json",
    "/api/v1/ready",
    "/api/v1/routes/plan",
    "/api/v1/saved-routes",
    "/api/v1/session",
    "/internal/metrics",
    "/privacy",
    "/terms",
  ]);
  return stablePaths.has(pathname) ? pathname : "/:unknown";
}

function prometheusLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export class RuntimeMetrics {
  private readonly requests = new Map<MetricKey, MetricValue>();
  private readonly processStartTimeSeconds = Date.now() / 1_000;
  private inFlight = 0;
  private backupStatus: BackupMetricStatus | null = null;

  setBackupStatus(status: BackupMetricStatus | null): void {
    this.backupStatus = status;
  }

  beginRequest(): void {
    this.inFlight += 1;
  }

  finishRequest(input: Readonly<{
    method: string;
    pathname: string;
    status: number;
    durationMs: number;
  }>): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const path = normalizedRoutePath(input.pathname);
    const key =
      `${input.method}\0${path}\0${input.status}` as MetricKey;
    const metric = this.requests.get(key) ?? {
      count: 0,
      durationMs: 0,
    };
    metric.count += 1;
    metric.durationMs += Math.max(0, input.durationMs);
    this.requests.set(key, metric);
  }

  toPrometheus(): string {
    const lines = [
      "# HELP zhaolu_http_requests_total HTTP requests by method, normalized path and status.",
      "# TYPE zhaolu_http_requests_total counter",
      "# HELP zhaolu_http_request_duration_ms_sum Cumulative HTTP request duration in milliseconds.",
      "# TYPE zhaolu_http_request_duration_ms_sum counter",
    ];
    [...this.requests.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, value]) => {
        const [method, path, status] = key.split("\0");
        const labels = `method="${prometheusLabel(method)}",path="${prometheusLabel(path)}",status="${status}"`;
        lines.push(
          `zhaolu_http_requests_total{${labels}} ${value.count}`,
        );
        lines.push(
          `zhaolu_http_request_duration_ms_sum{${labels}} ${value.durationMs.toFixed(3)}`,
        );
      });
    lines.push(
      "# HELP zhaolu_http_requests_in_flight Requests currently being processed.",
      "# TYPE zhaolu_http_requests_in_flight gauge",
      `zhaolu_http_requests_in_flight ${this.inFlight}`,
      "# HELP zhaolu_process_start_time_seconds Unix timestamp when the process started.",
      "# TYPE zhaolu_process_start_time_seconds gauge",
      `zhaolu_process_start_time_seconds ${this.processStartTimeSeconds.toFixed(3)}`,
    );
    if (this.backupStatus) {
      lines.push(
        "# HELP zhaolu_sqlite_backup_last_success_timestamp_seconds Unix timestamp of the latest verified SQLite backup.",
        "# TYPE zhaolu_sqlite_backup_last_success_timestamp_seconds gauge",
        `zhaolu_sqlite_backup_last_success_timestamp_seconds ${Date.parse(this.backupStatus.createdAt) / 1_000}`,
        "# HELP zhaolu_sqlite_backup_last_restore_verification_timestamp_seconds Unix timestamp of the latest automatic restore drill.",
        "# TYPE zhaolu_sqlite_backup_last_restore_verification_timestamp_seconds gauge",
        `zhaolu_sqlite_backup_last_restore_verification_timestamp_seconds ${Date.parse(this.backupStatus.restoreVerifiedAt) / 1_000}`,
        "# HELP zhaolu_sqlite_backup_size_bytes Size of the latest verified SQLite backup.",
        "# TYPE zhaolu_sqlite_backup_size_bytes gauge",
        `zhaolu_sqlite_backup_size_bytes ${this.backupStatus.sizeBytes}`,
      );
    }
    lines.push("");
    return lines.join("\n");
  }
}
