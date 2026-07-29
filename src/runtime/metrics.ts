type MetricKey = `${string}\0${string}\0${number}`;

type MetricValue = {
  count: number;
  durationMs: number;
};

export function normalizedRoutePath(pathname: string): string {
  if (pathname.startsWith("/assets/")) return "/assets/:asset";
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
    "/api/v1/openapi.json",
    "/api/v1/ready",
    "/api/v1/routes/plan",
    "/api/v1/saved-routes",
    "/api/v1/session",
    "/internal/metrics",
  ]);
  return stablePaths.has(pathname) ? pathname : "/:unknown";
}

function prometheusLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export class RuntimeMetrics {
  private readonly requests = new Map<MetricKey, MetricValue>();
  private inFlight = 0;

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
      "",
    );
    return lines.join("\n");
  }
}
