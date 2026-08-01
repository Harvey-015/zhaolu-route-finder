import { pathToFileURL } from "node:url";

type OperationsFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type OperationsSmokeResult = Readonly<{
  status: "passed" | "failed";
  requestCount: number;
  checks: readonly string[];
  code?: string;
}>;

export type OperationsSmokeOptions = Readonly<{
  environment?: NodeJS.ProcessEnv;
  fetcher?: OperationsFetch;
  now?: () => number;
}>;

type OperationsSmokeConfig = Readonly<{
  origin: URL;
  token: string;
  maximumBackupAgeMs: number;
}>;

function config(
  environment: NodeJS.ProcessEnv,
): OperationsSmokeConfig {
  const rawOrigin = environment.OPERATIONS_BASE_URL?.trim() ?? "";
  const token =
    environment.ZHAOLU_OBSERVABILITY_TOKEN?.trim() ?? "";
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("OPERATIONS_CONFIGURATION_INVALID");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    token.length < 32
  ) {
    throw new Error("OPERATIONS_CONFIGURATION_INVALID");
  }
  const maximumAgeHours = Number(
    environment.OPERATIONS_MAX_BACKUP_AGE_HOURS?.trim() || "26",
  );
  if (
    !Number.isInteger(maximumAgeHours) ||
    maximumAgeHours < 1 ||
    maximumAgeHours > 168
  ) {
    throw new Error("OPERATIONS_CONFIGURATION_INVALID");
  }
  return Object.freeze({
    origin,
    token,
    maximumBackupAgeMs: maximumAgeHours * 60 * 60_000,
  });
}

function metric(body: string, name: string): number {
  const match = new RegExp(`^${name} ([0-9]+(?:\\.[0-9]+)?)$`, "m").exec(
    body,
  );
  const value = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error("OPERATIONS_METRIC_INVALID");
  }
  return value;
}

export async function runOperationsSmoke(
  options: OperationsSmokeOptions = {},
): Promise<OperationsSmokeResult> {
  let smokeConfig: OperationsSmokeConfig;
  try {
    smokeConfig = config(options.environment ?? process.env);
  } catch {
    return {
      status: "failed",
      requestCount: 0,
      checks: [],
      code: "OPERATIONS_CONFIGURATION_INVALID",
    };
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const checks: string[] = [];
  let requestCount = 0;
  try {
    requestCount += 1;
    const unauthorized = await fetcher(
      new URL("/internal/metrics", smokeConfig.origin),
      { signal: AbortSignal.timeout(10_000) },
    );
    if (unauthorized.status !== 401) {
      throw new Error("OPERATIONS_METRICS_PUBLIC");
    }
    checks.push("metrics-protected");

    requestCount += 1;
    const metricsResponse = await fetcher(
      new URL("/internal/metrics", smokeConfig.origin),
      {
        headers: {
          authorization: `Bearer ${smokeConfig.token}`,
          "user-agent": "zhaolu-operations-smoke/1",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!metricsResponse.ok) {
      throw new Error("OPERATIONS_METRICS_UNAVAILABLE");
    }
    const body = await metricsResponse.text();
    metric(body, "zhaolu_process_start_time_seconds");
    const backupTime =
      metric(
        body,
        "zhaolu_sqlite_backup_last_success_timestamp_seconds",
      ) * 1_000;
    const restoreTime =
      metric(
        body,
        "zhaolu_sqlite_backup_last_restore_verification_timestamp_seconds",
      ) * 1_000;
    if (
      metric(body, "zhaolu_sqlite_backup_size_bytes") < 1 ||
      backupTime > now() + 5 * 60_000 ||
      restoreTime > now() + 5 * 60_000 ||
      now() - backupTime > smokeConfig.maximumBackupAgeMs ||
      now() - restoreTime > smokeConfig.maximumBackupAgeMs
    ) {
      throw new Error("OPERATIONS_BACKUP_STALE");
    }
    checks.push("backup-and-restore-fresh");

    requestCount += 1;
    const readiness = await fetcher(
      new URL("/api/v1/ready", smokeConfig.origin),
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const readinessBody = (await readiness.json()) as {
      status?: unknown;
    };
    if (!readiness.ok || readinessBody.status !== "ready") {
      throw new Error("OPERATIONS_READINESS_INVALID");
    }
    checks.push("ready");

    return { status: "passed", requestCount, checks };
  } catch {
    return {
      status: "failed",
      requestCount,
      checks,
      code: "OPERATIONS_REQUEST_FAILED",
    };
  }
}

async function main() {
  const result = await runOperationsSmoke();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
