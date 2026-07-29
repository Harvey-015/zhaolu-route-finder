import { createProductionRoutePlanner } from "../src/server-api/composition.ts";
import { createServerApi } from "../src/server-api/handler.ts";
import { createNodeApiServer } from "../src/server-api/nodeServer.ts";

function serverPort(): number {
  const value = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new RangeError("SERVER_PORT_INVALID");
  }
  return value;
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = serverPort();
const planRoutes = createProductionRoutePlanner({
  amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY ?? "",
  amapCity: process.env.AMAP_CITY,
});
const server = createNodeApiServer(
  createServerApi({ planRoutes }),
);

server.listen(port, host, () => {
  process.stdout.write(
    `zhaolu-route-finder API listening on http://${host}:${port}\n`,
  );
});

const close = () => {
  server.close(() => {
    process.exitCode = 0;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
