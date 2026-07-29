import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  MAX_SERVER_API_BODY_BYTES,
  type ServerApiHandler,
} from "./handler.ts";

type NodeBody = Readonly<{
  bytes: Uint8Array | null;
  tooLarge: boolean;
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

export function createNodeApiServer(
  handler: ServerApiHandler,
): Server {
  return createServer(async (request, response) => {
    try {
      const webRequest = await toWebRequest(request, response);
      const webResponse = await handler(webRequest);
      await writeNodeResponse(response, webResponse);
    } catch {
      writeTransportFailure(response);
    }
  });
}
