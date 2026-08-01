import type {
  ApiRecommendedRoute,
  PlanRoutesApiRequest,
} from "../../src/server-api/contracts.ts";
import type {
  FieldReport,
  SavedRouteSummary,
} from "../../src/user-data/models.ts";
import {
  RouteApiError,
  type RouteApiFetch,
} from "./api.ts";

export type AnonymousSession = Readonly<{
  token: string;
  expiresAt: number;
}>;

export type AnonymousSessionCoordinator = Readonly<{
  token(): Promise<string>;
  run<T>(operation: (token: string) => Promise<T>): Promise<T>;
}>;

export function createAnonymousSessionCoordinator(options: Readonly<{
  read(): AnonymousSession | null;
  write(session: AnonymousSession): void;
  clear(): void;
  create?: () => Promise<AnonymousSession>;
}>): AnonymousSessionCoordinator {
  let creation: Promise<AnonymousSession> | null = null;
  const create = options.create ?? (() => createAnonymousSession());

  const token = async (forceNew = false): Promise<string> => {
    if (!forceNew) {
      const existing = options.read();
      if (existing) return existing.token;
    }
    if (!creation) {
      const pending = create().then((session) => {
        options.write(session);
        return session;
      });
      creation = pending;
      const clearCreation = () => {
        if (creation === pending) creation = null;
      };
      void pending.then(clearCreation, clearCreation);
    }
    return (await creation).token;
  };

  return {
    token: () => token(false),
    async run<T>(operation: (token: string) => Promise<T>): Promise<T> {
      try {
        return await operation(await token(false));
      } catch (error) {
        if (!(error instanceof RouteApiError) || error.status !== 401) {
          throw error;
        }
        options.clear();
        return operation(await token(true));
      }
    },
  };
}

async function jsonPayload(
  response: Response,
): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      response.status,
      false,
    );
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      response.status,
      false,
    );
  }
  if (!response.ok) {
    const error = (payload as {
      error?: {
        code?: unknown;
        retryable?: unknown;
      };
    }).error;
    throw new RouteApiError(
      typeof error?.code === "string"
        ? error.code
        : "API_REQUEST_FAILED",
      response.status,
      error?.retryable === true,
    );
  }
  return payload as Record<string, unknown>;
}

async function userDataRequest(
  path: string,
  init: RequestInit,
  fetcher: RouteApiFetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch {
    throw new RouteApiError("NETWORK_ERROR", 0, true);
  }
  return jsonPayload(response);
}

export async function createAnonymousSession(
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<AnonymousSession> {
  const payload = await userDataRequest(
    "/api/v1/session",
    {
      method: "POST",
      headers: {
        accept: "application/json",
      },
    },
    fetcher,
  );
  const session = payload.session;
  if (
    typeof session !== "object" ||
    session === null ||
    Array.isArray(session) ||
    typeof (session as { token?: unknown }).token !== "string" ||
    typeof (session as { expiresAt?: unknown }).expiresAt !==
      "number"
  ) {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      201,
      false,
    );
  }
  return session as AnonymousSession;
}

export async function saveRoute(
  token: string,
  input: Readonly<{
    name: string;
    request: PlanRoutesApiRequest;
    route: ApiRecommendedRoute;
  }>,
  idempotencyKey?: string,
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<SavedRouteSummary> {
  const payload = await userDataRequest(
    "/api/v1/saved-routes",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(idempotencyKey
          ? { "idempotency-key": idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        schemaVersion: "1",
        ...input,
      }),
    },
    fetcher,
  );
  return payload.route as SavedRouteSummary;
}

export async function listSavedRoutes(
  token: string,
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<readonly SavedRouteSummary[]> {
  const payload = await userDataRequest(
    "/api/v1/saved-routes",
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    },
    fetcher,
  );
  if (!Array.isArray(payload.routes)) {
    throw new RouteApiError(
      "INVALID_API_RESPONSE",
      200,
      false,
    );
  }
  return payload.routes as SavedRouteSummary[];
}

export async function deleteSavedRoute(
  token: string,
  routeId: string,
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<void> {
  await userDataRequest(
    `/api/v1/saved-routes/${encodeURIComponent(routeId)}`,
    {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    },
    fetcher,
  );
}

export async function deleteAllUserData(
  token: string,
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<void> {
  await userDataRequest(
    "/api/v1/session",
    {
      method: "DELETE",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    },
    fetcher,
  );
}

export async function sendFieldReport(
  token: string,
  routeId: string,
  rating: 1 | 2 | 3 | 4 | 5,
  fetcher: RouteApiFetch = globalThis.fetch,
): Promise<FieldReport> {
  const payload = await userDataRequest(
    `/api/v1/saved-routes/${encodeURIComponent(routeId)}/feedback`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: "1",
        rating,
      }),
    },
    fetcher,
  );
  return payload.report as FieldReport;
}
