import { pathToFileURL } from "node:url";

type ProductionSmokeResult = Readonly<{
  status: "passed" | "failed";
  requestCount: number;
  checks: readonly string[];
  code?: string;
}>;

function baseUrl(): URL {
  const raw = process.env.PRODUCTION_BASE_URL?.trim() ?? "";
  if (!raw) throw new RangeError("PRODUCTION_BASE_URL_REQUIRED");
  const url = new URL(raw);
  const local =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !local) {
    throw new RangeError("PRODUCTION_BASE_URL_HTTPS_REQUIRED");
  }
  return url;
}

export async function runProductionSmoke(): Promise<ProductionSmokeResult> {
  let origin: URL;
  try {
    origin = baseUrl();
  } catch {
    return {
      status: "failed",
      requestCount: 0,
      checks: [],
      code: "SMOKE_CONFIGURATION_INVALID",
    };
  }
  let requestCount = 0;
  const checks: string[] = [];
  const requestJson = async (path: string) => {
    requestCount += 1;
    const response = await fetch(new URL(path, origin), {
      headers: {
        accept: "application/json",
        "user-agent": "zhaolu-production-smoke/1",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("SMOKE_HTTP_FAILURE");
    return (await response.json()) as Record<string, unknown>;
  };

  try {
    const health = await requestJson("/api/v1/health");
    if (health.status !== "ok") {
      throw new Error("SMOKE_HEALTH_INVALID");
    }
    checks.push("health");

    const readiness = await requestJson("/api/v1/ready");
    if (readiness.status !== "ready") {
      throw new Error("SMOKE_READINESS_INVALID");
    }
    checks.push("ready");

    const capabilities = await requestJson(
      "/api/v1/capabilities",
    );
    if (
      capabilities.coordinateReferenceSystem !== "WGS84" ||
      capabilities.geometryFormat !== "GeoJSON"
    ) {
      throw new Error("SMOKE_CAPABILITIES_INVALID");
    }
    checks.push("capabilities");

    const homeResponse = await fetch(origin, {
      headers: {
        accept: "text/html",
        "user-agent": "zhaolu-production-smoke/1",
      },
      signal: AbortSignal.timeout(10_000),
    });
    requestCount += 1;
    if (
      !homeResponse.ok ||
      !homeResponse.headers
        .get("content-type")
        ?.startsWith("text/html")
    ) {
      throw new Error("SMOKE_WEB_INVALID");
    }
    checks.push("web");

    return {
      status: "passed",
      requestCount,
      checks,
    };
  } catch {
    return {
      status: "failed",
      requestCount,
      checks,
      code: "SMOKE_REQUEST_FAILED",
    };
  }
}

async function main() {
  const result = await runProductionSmoke();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
