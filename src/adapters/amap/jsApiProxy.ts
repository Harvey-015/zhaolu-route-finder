const AMAP_PROXY_PREFIX = "/_AMapService/";
const MAX_PROXY_BODY_BYTES = 64 * 1024;

type AmapProxyFetch = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

const ALLOWED_SERVICES = [
  {
    pattern: /^v4\/map\/styles(?:\/.*)?$/,
    origin: "https://webapi.amap.com",
  },
  {
    pattern: /^v3\/geocode\/(?:geo|regeo)$/,
    origin: "https://restapi.amap.com",
  },
  {
    pattern: /^v3\/place\/(?:text|around)$/,
    origin: "https://restapi.amap.com",
  },
  {
    pattern: /^v3\/assistant\/coordinate\/convert$/,
    origin: "https://restapi.amap.com",
  },
  {
    pattern: /^v(?:3|5)\/direction\/walking$/,
    origin: "https://restapi.amap.com",
  },
  {
    pattern: /^v(?:4|5)\/direction\/bicycling$/,
    origin: "https://restapi.amap.com",
  },
] as const;

function proxyError(code: string, status: number): Response {
  return Response.json(
    {
      schemaVersion: "1",
      error: { code, retryable: status >= 500 },
    },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function buildAmapJsApiUpstreamUrl(
  requestUrl: string,
  securityCode: string,
): URL | null {
  if (!securityCode) return null;
  const incoming = new URL(requestUrl);
  if (!incoming.pathname.startsWith(AMAP_PROXY_PREFIX)) return null;

  const servicePath = incoming.pathname.slice(AMAP_PROXY_PREFIX.length);
  const service = ALLOWED_SERVICES.find(({ pattern }) =>
    pattern.test(servicePath),
  );
  if (!service) return null;

  const upstream = new URL(`/${servicePath}`, service.origin);
  incoming.searchParams.forEach((value, key) => {
    if (key.toLowerCase() !== "jscode") {
      upstream.searchParams.append(key, value);
    }
  });
  upstream.searchParams.set("jscode", securityCode);
  return upstream;
}

export function isAllowedAmapJsApiBrowserRequest(
  request: Request,
  publicOrigin: string,
): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === publicOrigin;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === publicOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

function upstreamHeaders(request: Request): Headers {
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const contentType = request.headers.get("content-type");
  if (accept) headers.set("accept", accept);
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

function proxyResponseHeaders(
  upstream: Response,
  upstreamUrl: URL,
): Headers {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  if (upstreamUrl.searchParams.has("callback")) {
    headers.set("content-type", "application/javascript; charset=utf-8");
  } else {
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
  }
  return headers;
}

export async function proxyAmapJsApiRequest(
  request: Request,
  options: Readonly<{
    securityCode: string;
    publicOrigin: string;
    fetcher?: AmapProxyFetch;
  }>,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return proxyError("METHOD_NOT_ALLOWED", 405);
  }
  if (!isAllowedAmapJsApiBrowserRequest(request, options.publicOrigin)) {
    return proxyError("FORBIDDEN", 403);
  }
  const upstreamUrl = buildAmapJsApiUpstreamUrl(
    request.url,
    options.securityCode,
  );
  if (!upstreamUrl) return proxyError("AMAP_PROXY_PATH_UNSUPPORTED", 404);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_PROXY_BODY_BYTES) {
    return proxyError("REQUEST_BODY_TOO_LARGE", 413);
  }

  try {
    const upstream = await (options.fetcher ?? globalThis.fetch)(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders(request),
      body:
        request.method === "POST"
          ? await request.arrayBuffer()
          : undefined,
      redirect: "manual",
      signal: request.signal,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: proxyResponseHeaders(upstream, upstreamUrl),
    });
  } catch {
    return proxyError("AMAP_PROXY_UNAVAILABLE", 502);
  }
}
