import { createFixturePlanner } from "./smoke-server-api.ts";
import { resolveFixtureRouteDeliveryPolicy } from "../src/route-delivery/policy.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import { createNodeApiServer } from "../src/server-api/nodeServer.ts";
import { SignedSessionService } from "../src/user-data/auth.ts";
import { UserDataService } from "../src/user-data/service.ts";
import { SqliteUserDataStore } from "../src/user-data/sqliteStore.ts";

const planner = createFixturePlanner();
const store = new SqliteUserDataStore(":memory:");
const userData = new UserDataService({
  store,
  sessions: new SignedSessionService(
    "fixture-session-secret-not-for-production",
  ),
  policyResolver: resolveFixtureRouteDeliveryPolicy,
});
const server = createNodeApiServer(
  createServerApi({
    planRoutes: planner.planRoutes,
    requestIdFactory: () => crypto.randomUUID(),
    deliveryPolicyResolver: resolveFixtureRouteDeliveryPolicy,
    legalConfig: {
      operatorName: "找路测试运营者",
      privacyContact: "privacy@example.test",
      logRetentionDays: 30,
    },
    userData,
  }),
);

server.listen(8787, "127.0.0.1", () => {
  process.stdout.write(
    "Fixture API listening on http://127.0.0.1:8787\n",
  );
});

const close = () => {
  server.close(() => {
    store.close();
    process.exitCode = 0;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
