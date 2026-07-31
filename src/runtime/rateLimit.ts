export type ApiRateLimitScope =
  | "plan"
  | "session"
  | "user-data";

export type RateLimitResult = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}>;

export interface ApiRateLimiter {
  consume(
    key: string,
    scope: ApiRateLimitScope,
  ): RateLimitResult;
}

type WindowState = {
  count: number;
  resetsAt: number;
};

export class FixedWindowRateLimiter implements ApiRateLimiter {
  private readonly limits: Readonly<
    Record<
      ApiRateLimitScope,
      Readonly<{ maximum: number; windowMs: number }>
    >
  >;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly windows = new Map<string, WindowState>();

  constructor(options: Readonly<{
    limits: Readonly<
      Record<
        ApiRateLimitScope,
        Readonly<{ maximum: number; windowMs: number }>
      >
    >;
    now?: () => number;
    maxEntries?: number;
  }>) {
    Object.values(options.limits).forEach(
      ({ maximum, windowMs }) => {
        if (
          !Number.isInteger(maximum) ||
          maximum < 1 ||
          !Number.isInteger(windowMs) ||
          windowMs < 1_000
        ) {
          throw new RangeError("RATE_LIMIT_CONFIGURATION_INVALID");
        }
      },
    );
    this.limits = options.limits;
    this.now = options.now ?? (() => Date.now());
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  private prune(now: number): void {
    for (const [key, value] of this.windows) {
      if (value.resetsAt <= now) this.windows.delete(key);
    }
  }

  consume(
    key: string,
    scope: ApiRateLimitScope,
  ): RateLimitResult {
    const now = this.now();
    const limit = this.limits[scope];
    const storageKey = `${scope}\0${key}`;
    let state = this.windows.get(storageKey);
    if (!state || state.resetsAt <= now) {
      if (this.windows.size >= this.maxEntries) this.prune(now);
      if (
        this.windows.size >= this.maxEntries &&
        !this.windows.has(storageKey)
      ) {
        return {
          allowed: false,
          retryAfterSeconds: 1,
          remaining: 0,
        };
      }
      state = {
        count: 0,
        resetsAt: now + limit.windowMs,
      };
      this.windows.set(storageKey, state);
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((state.resetsAt - now) / 1_000),
    );
    if (state.count >= limit.maximum) {
      return {
        allowed: false,
        retryAfterSeconds,
        remaining: 0,
      };
    }
    state.count += 1;
    return {
      allowed: true,
      retryAfterSeconds,
      remaining: Math.max(0, limit.maximum - state.count),
    };
  }
}
