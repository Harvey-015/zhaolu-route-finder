import { ProviderError } from "../../route-recommendation/errors.ts";
import type { ProviderCallContext } from "../../route-recommendation/ports.ts";
import {
  amapApiFailure,
  invalidAmapResponse,
} from "./errors.ts";

const DEFAULT_BASE_URL = "https://restapi.amap.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 100;
const DEFAULT_MAX_ATTEMPTS_PER_MINUTE = 300;

export type AmapFetch = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

export type AmapWebServiceClientOptions = Readonly<{
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  maxAttemptsPerMinute?: number;
  now?: () => number;
  fetcher?: AmapFetch;
}>;

export class AmapWebServiceClient {
  private readonly apiKey: string;
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly maxAttemptsPerMinute: number;
  private readonly now: () => number;
  private readonly fetcher: AmapFetch;
  private attemptWindow = { count: 0, resetsAt: 0 };

  constructor(options: AmapWebServiceClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) {
      throw new TypeError("AMAP_API_KEY_REQUIRED");
    }
    const baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new TypeError("AMAP_BASE_URL_INVALID");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("AMAP_TIMEOUT_INVALID");
    }
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 3
    ) {
      throw new RangeError("AMAP_MAX_ATTEMPTS_INVALID");
    }
    const retryDelayMs =
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
      throw new RangeError("AMAP_RETRY_DELAY_INVALID");
    }
    const maxAttemptsPerMinute =
      options.maxAttemptsPerMinute ??
      DEFAULT_MAX_ATTEMPTS_PER_MINUTE;
    if (
      !Number.isInteger(maxAttemptsPerMinute) ||
      maxAttemptsPerMinute < 1 ||
      maxAttemptsPerMinute > 100_000
    ) {
      throw new RangeError("AMAP_GLOBAL_ATTEMPT_LIMIT_INVALID");
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.retryDelayMs = retryDelayMs;
    this.maxAttemptsPerMinute = maxAttemptsPerMinute;
    this.now = options.now ?? (() => Date.now());
    this.fetcher =
      options.fetcher ??
      ((input, init) => globalThis.fetch(input, init));
  }

  private consumeAttemptBudgets(
    providerId: string,
    context: ProviderCallContext,
  ): void {
    context.physicalCallBudget?.consume(providerId);
    const now = this.now();
    if (this.attemptWindow.resetsAt <= now) {
      this.attemptWindow = {
        count: 0,
        resetsAt: now + 60_000,
      };
    }
    if (this.attemptWindow.count >= this.maxAttemptsPerMinute) {
      throw new ProviderError({
        providerId,
        code: "QUOTA_EXCEEDED",
        message: "AMAP_GLOBAL_ATTEMPT_LIMIT_EXCEEDED",
        retryable: false,
      });
    }
    this.attemptWindow.count += 1;
  }

  async getJson(
    providerId: string,
    path: string,
    parameters: Readonly<Record<string, string | undefined>>,
    context: ProviderCallContext,
  ): Promise<unknown> {
    if (!path.startsWith("/") || path.includes("..")) {
      throw new TypeError("AMAP_PATH_INVALID");
    }
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.getJsonAttempt(
          providerId,
          path,
          parameters,
          context,
        );
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          !error.retryable ||
          error.code === "ABORTED" ||
          attempt === this.maxAttempts
        ) {
          throw error;
        }
        lastError = error;
        await this.waitBeforeRetry(providerId, context.signal);
      }
    }

    throw lastError ?? invalidAmapResponse(providerId);
  }

  private async waitBeforeRetry(
    providerId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new ProviderError({
        providerId,
        code: "ABORTED",
        message: "AMAP_REQUEST_ABORTED",
      });
    }
    if (this.retryDelayMs === 0) return;

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(
          new ProviderError({
            providerId,
            code: "ABORTED",
            message: "AMAP_REQUEST_ABORTED",
          }),
        );
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, this.retryDelayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async getJsonAttempt(
    providerId: string,
    path: string,
    parameters: Readonly<Record<string, string | undefined>>,
    context: ProviderCallContext,
  ): Promise<unknown> {
    if (context.signal?.aborted) {
      throw new ProviderError({
        providerId,
        code: "ABORTED",
        message: "AMAP_REQUEST_ABORTED",
      });
    }
    this.consumeAttemptBudgets(providerId, context);

    const url = new URL(path, this.baseUrl);
    Object.entries(parameters).forEach(([name, value]) => {
      if (value !== undefined) url.searchParams.set(name, value);
    });
    url.searchParams.set("key", this.apiKey);

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    context.signal?.addEventListener("abort", abortFromCaller, {
      once: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });

      if (response.status === 429) {
        throw new ProviderError({
          providerId,
          code: "QUOTA_EXCEEDED",
          message: "AMAP_QUOTA_EXCEEDED",
          retryable: false,
        });
      }
      if (response.status === 408 || response.status === 504) {
        throw new ProviderError({
          providerId,
          code: "TIMEOUT",
          message: "AMAP_REQUEST_TIMEOUT",
          retryable: true,
        });
      }
      if (response.status >= 500) {
        throw new ProviderError({
          providerId,
          code: "UNAVAILABLE",
          message: "AMAP_SERVICE_UNAVAILABLE",
          retryable: true,
        });
      }
      if (!response.ok) {
        throw new ProviderError({
          providerId,
          code: "UNAVAILABLE",
          message: "AMAP_REQUEST_REJECTED",
          retryable: false,
        });
      }

      try {
        const payload: unknown = await response.json();
        if (
          typeof payload === "object" &&
          payload !== null &&
          !Array.isArray(payload)
        ) {
          const envelope = payload as Record<string, unknown>;
          if (
            envelope.status === "0" &&
            typeof envelope.infocode === "string"
          ) {
            throw amapApiFailure(providerId, envelope.infocode);
          }
        }
        return payload;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw invalidAmapResponse(providerId);
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (context.signal?.aborted) {
        throw new ProviderError({
          providerId,
          code: "ABORTED",
          message: "AMAP_REQUEST_ABORTED",
        });
      }
      if (timedOut) {
        throw new ProviderError({
          providerId,
          code: "TIMEOUT",
          message: "AMAP_REQUEST_TIMEOUT",
          retryable: true,
        });
      }
      throw new ProviderError({
        providerId,
        code: "UNAVAILABLE",
        message: "AMAP_SERVICE_UNAVAILABLE",
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}
