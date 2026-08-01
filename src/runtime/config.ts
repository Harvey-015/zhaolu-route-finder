import { resolve } from "node:path";

export type RuntimeLogLevel = "info" | "error";

export type RuntimeConfig = Readonly<{
  host: string;
  port: number;
  amapWebServiceKey: string;
  amapCity?: string;
  amapMaxHttpAttemptsPerPlan: number;
  amapMaxHttpAttemptsPerMinute: number;
  sessionSecret: string;
  observabilityToken: string;
  databasePath: string;
  staticRoot: string;
  trustedProxyRanges: readonly string[];
  logLevel: RuntimeLogLevel;
  shutdownTimeoutMs: number;
  rateLimits: Readonly<{
    planPerMinute: number;
    sessionPerHour: number;
    userDataPerMinute: number;
  }>;
}>;

function requiredSecret(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim() ?? "";
  if (value.length < 32) {
    throw new RangeError(`${name}_REQUIRED`);
  }
  return value;
}

function requiredValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim() ?? "";
  if (!value) throw new RangeError(`${name}_REQUIRED`);
  return value;
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${name}_INVALID`);
  }
  return value;
}

function commaSeparatedList(
  environment: NodeJS.ProcessEnv,
  name: string,
): readonly string[] {
  const raw = environment[name]?.trim();
  if (!raw) return Object.freeze([]);
  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => !value)) {
    throw new RangeError(`${name}_INVALID`);
  }
  return Object.freeze(values);
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  workingDirectory = process.cwd(),
): RuntimeConfig {
  const logLevel = environment.LOG_LEVEL?.trim() || "info";
  if (logLevel !== "info" && logLevel !== "error") {
    throw new RangeError("LOG_LEVEL_INVALID");
  }
  return Object.freeze({
    host: environment.HOST?.trim() || "0.0.0.0",
    port: integer(environment, "PORT", 8787, 1, 65_535),
    amapWebServiceKey: requiredValue(
      environment,
      "AMAP_WEB_SERVICE_KEY",
    ),
    ...(environment.AMAP_CITY?.trim()
      ? { amapCity: environment.AMAP_CITY.trim() }
      : {}),
    amapMaxHttpAttemptsPerPlan: integer(
      environment,
      "AMAP_MAX_HTTP_ATTEMPTS_PER_PLAN",
      24,
      1,
      1_000,
    ),
    amapMaxHttpAttemptsPerMinute: integer(
      environment,
      "AMAP_MAX_HTTP_ATTEMPTS_PER_MINUTE",
      300,
      1,
      100_000,
    ),
    sessionSecret: requiredSecret(
      environment,
      "ZHAOLU_SESSION_SECRET",
    ),
    observabilityToken: requiredSecret(
      environment,
      "ZHAOLU_OBSERVABILITY_TOKEN",
    ),
    databasePath: resolve(
      workingDirectory,
      environment.ZHAOLU_DATABASE_PATH?.trim() ||
        "data/zhaolu.sqlite",
    ),
    staticRoot: resolve(
      workingDirectory,
      environment.ZHAOLU_STATIC_ROOT?.trim() || "web-dist",
    ),
    trustedProxyRanges: commaSeparatedList(
      environment,
      "ZHAOLU_TRUSTED_PROXY_RANGES",
    ),
    logLevel,
    shutdownTimeoutMs: integer(
      environment,
      "SHUTDOWN_TIMEOUT_MS",
      10_000,
      1_000,
      60_000,
    ),
    rateLimits: {
      planPerMinute: integer(
        environment,
        "RATE_LIMIT_PLAN_PER_MINUTE",
        30,
        1,
        10_000,
      ),
      sessionPerHour: integer(
        environment,
        "RATE_LIMIT_SESSION_PER_HOUR",
        10,
        1,
        10_000,
      ),
      userDataPerMinute: integer(
        environment,
        "RATE_LIMIT_USER_DATA_PER_MINUTE",
        120,
        1,
        100_000,
      ),
    },
  });
}
