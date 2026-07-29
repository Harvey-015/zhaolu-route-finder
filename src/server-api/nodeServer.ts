import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import type { RuntimeLogger } from "../runtime/logger.ts";
import { safeRequestLogFields } from "../runtime/logger.ts";
import type { RuntimeMetrics } from "../runtime/metrics.ts";
import {
  MAX_SERVER_API_BODY_BYTES,
  type ServerApiHandler,
} from "./handler.ts";

type NodeBody = Readonly<{
  bytes: Uint8Array | null;
  tooLarge: boolean;
}>;

export type NodeApiServerOptions = Readonly<{
  staticRoot?: string;
  metrics?: RuntimeMetrics;
  logger?: RuntimeLogger;
  observabilityToken?: string;
}>;

function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  Object.entries(headers).forEach(([name, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => result.append(name, item));
    } else if (value !== undefined) {
      result.set(name, value);
    }
  });
  return result;
}

async function readNodeBody(
  request: IncomingMessage,
): Promise<NodeBody> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const bytes =
      typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : new Uint8Array(chunk);
    totalLength += bytes.byteLength;
    if (totalLength > MAX_SERVER_API_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(bytes);
  }
  if (tooLarge) return { bytes: null, tooLarge: true };
  const body = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return { bytes: body, tooLarge: false };
}

async function toWebRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<Request> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const headers = webHeaders(request.headers);
  headers.set(
    "x-zhaolu-client-key",
    request.socket.remoteAddress ?? "unknown",
  );
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  const body =
    method === "GET" || method === "HEAD"
      ? { bytes: null, tooLarge: false }
      : await readNodeBody(request);
  if (body.tooLarge) {
    headers.set(
      "content-length",
      String(MAX_SERVER_API_BODY_BYTES + 1),
    );
  }
  return new Request(url, {
    method,
    headers,
    body:
      body.bytes && body.bytes.byteLength > 0
        ? new TextDecoder().decode(body.bytes)
        : undefined,
    signal: controller.signal,
  });
}

async function writeNodeResponse(
  response: ServerResponse,
  webResponse: Response,
): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => {
    response.setHeader(name, value);
  });
  const bytes = new Uint8Array(await webResponse.arrayBuffer());
  response.end(bytes);
}

function writeTransportFailure(response: ServerResponse): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.statusCode = 500;
  response.setHeader(
    "content-type",
    "application/json; charset=utf-8",
  );
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(
    JSON.stringify({
      schemaVersion: "1",
      requestId: "node-transport",
      error: { code: "INTERNAL_ERROR", retryable: false },
    }),
  );
}

const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function staticHeaders(pathname: string): Headers {
  return new Headers({
    "cache-control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "content-security-policy":
      "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    "content-type":
      STATIC_CONTENT_TYPES[extname(pathname).toLowerCase()] ??
      "application/octet-stream",
    "permissions-policy":
      "camera=(), geolocation=(), microphone=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
}

async function staticResponse(
  request: IncomingMessage,
  staticRoot: string,
): Promise<Response | null> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(request.url ?? "/", "http://localhost");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return new Response(null, { status: 400 });
  }
  const root = resolve(staticRoot);
  const relativePath =
    decodedPath === "/"
      ? "index.html"
      : decodedPath.replace(/^\/+/, "");
  let candidate = resolve(root, relativePath);
  if (
    candidate !== root &&
    !candidate.startsWith(`${root}${sep}`)
  ) {
    return new Response(null, { status: 404 });
  }
  let pathname =
    decodedPath === "/" ? "/index.html" : decodedPath;
  let bytes: Buffer;
  try {
    bytes = await readFile(candidate);
  } catch {
    candidate = resolve(root, "index.html");
    pathname = "/index.html";
    try {
      bytes = await readFile(candidate);
    } catch {
      return null;
    }
  }
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: staticHeaders(pathname),
  });
}

function validObservabilityToken(
  authorization: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!authorization || !expectedToken) return false;
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expectedToken);
  return (
    suppliedBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function createNodeApiServer(
  handler: ServerApiHandler,
  options: NodeApiServerOptions = {},
): Server {
  return createServer(async (request, response) => {
    const startedAt = performance.now();
    const method = request.method ?? "GET";
    const pathname = new URL(
      request.url ?? "/",
      "http://localhost",
    ).pathname;
    options.metrics?.beginRequest();
    let status = 500;
    let requestId: string | null = null;
    try {
      let webResponse: Response | null = null;
      if (pathname === "/internal/metrics") {
        if (
          !validObservabilityToken(
            request.headers.authorization,
            options.observabilityToken,
          )
        ) {
          webResponse = new Response("Unauthorized\n", {
            status: 401,
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
              "www-authenticate": "Bearer",
              "x-content-type-options": "nosniff",
            },
          });
        } else if (method !== "GET") {
          webResponse = new Response("Method Not Allowed\n", {
            status: 405,
            headers: {
              allow: "GET",
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
            },
          });
        } else {
          webResponse = new Response(
            options.metrics?.toPrometheus() ?? "",
            {
              status: 200,
              headers: {
                "cache-control": "no-store",
                "content-type":
                  "text/plain; version=0.0.4; charset=utf-8",
                "x-content-type-options": "nosniff",
              },
            },
          );
        }
      } else if (
        options.staticRoot &&
        !pathname.startsWith("/api/")
      ) {
        webResponse = await staticResponse(
          request,
          options.staticRoot,
        );
      }
      if (!webResponse) {
        const webRequest = await toWebRequest(request, response);
        webResponse = await handler(webRequest);
      }
      status = webResponse.status;
      requestId = webResponse.headers.get("x-request-id");
      await writeNodeResponse(response, webResponse);
    } catch {
      writeTransportFailure(response);
      status = 500;
      options.logger?.error(
        "http_transport_failure",
        safeRequestLogFields({
          method,
          pathname,
          status,
          durationMs: performance.now() - startedAt,
        }),
      );
    } finally {
      const durationMs = performance.now() - startedAt;
      options.metrics?.finishRequest({
        method,
        pathname,
        status,
        durationMs,
      });
      options.logger?.info(
        "http_request",
        safeRequestLogFields({
          method,
          pathname,
          status,
          durationMs,
          requestId,
        }),
      );
    }
  });
}
