import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRouteDeliveryPolicy } from "../route-delivery/policy.ts";
import { createProductionRoutePlanner } from "../server-api/composition.ts";
import { createServerApi } from "../server-api/handler.ts";
import { createNodeApiServer } from "../server-api/nodeServer.ts";
import { SignedSessionService } from "../user-data/auth.ts";
import { UserDataService } from "../user-data/service.ts";
import { SqliteUserDataStore } from "../user-data/sqliteStore.ts";
import { loadRuntimeConfig } from "./config.ts";
import { createJsonLogger } from "./logger.ts";
import { RuntimeMetrics } from "./metrics.ts";
import { FixedWindowRateLimiter } from "./rateLimit.ts";

export async function startProductionRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
) {
  const config = loadRuntimeConfig(
    environment,
    workingDirectory,
  );
  const logger = createJsonLogger({
    minimumLevel: config.logLevel,
  });
  const metrics = new RuntimeMetrics();
  const rateLimiter = new FixedWindowRateLimiter({
    limits: {
      plan: {
        maximum: config.rateLimits.planPerMinute,
        windowMs: 60_000,
      },
      session: {
        maximum: config.rateLimits.sessionPerHour,
        windowMs: 60 * 60_000,
      },
      "user-data": {
        maximum: config.rateLimits.userDataPerMinute,
        windowMs: 60_000,
      },
    },
  });

  mkdirSync(dirname(config.databasePath), { recursive: true });
  const store = new SqliteUserDataStore(config.databasePath);
  const userData = new UserDataService({
    store,
    sessions: new SignedSessionService(config.sessionSecret),
    policyResolver: resolveRouteDeliveryPolicy,
  });
  const initialPurgedRecords = userData.purgeExpired();
  if (initialPurgedRecords > 0) {
    logger.info("expired_records_purged", {
      count: initialPurgedRecords,
    });
  }
  const expiryCleanup = setInterval(() => {
    const count = userData.purgeExpired();
    if (count > 0) {
      logger.info("expired_records_purged", { count });
    }
  }, 60 * 60_000);
  expiryCleanup.unref();
  const planRoutes = createProductionRoutePlanner({
    amapWebServiceKey: config.amapWebServiceKey,
    amapCity: config.amapCity,
    amapMaxHttpAttemptsPerMinute:
      config.amapMaxHttpAttemptsPerMinute,
    limits: {
      maxProviderHttpAttempts:
        config.amapMaxHttpAttemptsPerPlan,
    },
  });
  const handler = createServerApi({
    planRoutes,
    deliveryPolicyResolver: resolveRouteDeliveryPolicy,
    userData,
    rateLimiter,
    eventLogger: logger,
    readinessCheck: async () => ({
      database: store.isHealthy() ? "ok" : "error",
      staticFiles: existsSync(
        join(config.staticRoot, "index.html"),
      )
        ? "ok"
        : "error",
    }),
    ...(config.amapWebMap
      ? {
          webMapConfig: {
            providerId: "amap-jsapi" as const,
            key: config.amapWebMap.webJsKey,
            serviceHost: "/_AMapService" as const,
          },
        }
      : {}),
  });
  const server = createNodeApiServer(handler, {
    staticRoot: config.staticRoot,
    logger,
    metrics,
    observabilityToken: config.observabilityToken,
    trustedProxyRanges: config.trustedProxyRanges,
    ...(config.amapWebMap
      ? {
          amapJsApiProxy: {
            securityCode: config.amapWebMap.securityCode,
            publicOrigin: config.amapWebMap.publicOrigin,
          },
        }
      : {}),
  });
  let closing: Promise<void> | null = null;

  const close = (reason = "requested"): Promise<void> => {
    if (closing) return closing;
    logger.info("runtime_stopping", { reason });
    closing = new Promise<void>((resolveClose) => {
      clearInterval(expiryCleanup);
      const forceTimer = setTimeout(() => {
        logger.error("runtime_shutdown_timeout", {
          timeoutMs: config.shutdownTimeoutMs,
        });
        server.closeAllConnections();
      }, config.shutdownTimeoutMs);
      forceTimer.unref();
      server.close(() => {
        clearTimeout(forceTimer);
        store.close();
        logger.info("runtime_stopped", { reason });
        resolveClose();
      });
    });
    return closing;
  };

  process.once("SIGINT", () => {
    void close("SIGINT");
  });
  process.once("SIGTERM", () => {
    void close("SIGTERM");
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(config.port, config.host, () => {
        server.removeListener("error", rejectListen);
        resolveListen();
      });
    });
  } catch (error) {
    clearInterval(expiryCleanup);
    store.close();
    throw error;
  }

  logger.info("runtime_started", {
    host: config.host,
    port: config.port,
    staticRoot: config.staticRoot,
  });
  return {
    close,
    config,
    metrics,
    server,
  } as const;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startProductionRuntime();
}
