import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createProductionRoutePlanner } from "../src/server-api/composition.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import { createNodeApiServer } from "../src/server-api/nodeServer.ts";
import { resolveRouteDeliveryPolicy } from "../src/route-delivery/policy.ts";
import { SignedSessionService } from "../src/user-data/auth.ts";
import { UserDataService } from "../src/user-data/service.ts";
import { SqliteUserDataStore } from "../src/user-data/sqliteStore.ts";

function serverPort(): number {
  const value = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new RangeError("SERVER_PORT_INVALID");
  }
  return value;
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = serverPort();
const sessionSecret =
  process.env.ZHAOLU_SESSION_SECRET?.trim() ?? "";
if (sessionSecret.length < 32) {
  throw new RangeError("ZHAOLU_SESSION_SECRET_REQUIRED");
}
const databasePath = resolve(
  process.env.ZHAOLU_DATABASE_PATH?.trim() ||
    "data/zhaolu.sqlite",
);
mkdirSync(dirname(databasePath), { recursive: true });
const userDataStore = new SqliteUserDataStore(databasePath);
const userData = new UserDataService({
  store: userDataStore,
  sessions: new SignedSessionService(sessionSecret),
  policyResolver: resolveRouteDeliveryPolicy,
});
const planRoutes = createProductionRoutePlanner({
  amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY ?? "",
  amapCity: process.env.AMAP_CITY,
});
const server = createNodeApiServer(
  createServerApi({
    planRoutes,
    deliveryPolicyResolver: resolveRouteDeliveryPolicy,
    userData,
  }),
);

server.listen(port, host, () => {
  process.stdout.write(
    `zhaolu-route-finder API listening on http://${host}:${port}\n`,
  );
});

const close = () => {
  server.close(() => {
    userDataStore.close();
    process.exitCode = 0;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
