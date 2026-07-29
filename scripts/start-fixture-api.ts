import { createFixturePlanner } from "./smoke-server-api.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import { createNodeApiServer } from "../src/server-api/nodeServer.ts";

const planner = createFixturePlanner();
const server = createNodeApiServer(
  createServerApi({
    planRoutes: planner.planRoutes,
    requestIdFactory: () => crypto.randomUUID(),
  }),
);

server.listen(8787, "127.0.0.1", () => {
  process.stdout.write(
    "Fixture API listening on http://127.0.0.1:8787\n",
  );
});

const close = () => {
  server.close(() => {
    process.exitCode = 0;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
