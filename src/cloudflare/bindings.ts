export type D1Primitive =
  | null
  | number
  | string
  | ArrayBuffer
  | ArrayBufferView;

export type D1Result<T = unknown> = Readonly<{
  success: boolean;
  results?: readonly T[];
  meta?: Readonly<{ changes?: number }>;
}>;

export interface D1PreparedStatement {
  bind(...values: readonly D1Primitive[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(
    statements: readonly D1PreparedStatement[],
  ): Promise<readonly D1Result<T>[]>;
}

export interface R2ObjectBodyBinding {
  readonly customMetadata?: Readonly<Record<string, string>>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketBinding {
  get(key: string): Promise<R2ObjectBodyBinding | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: Readonly<{
      httpMetadata?: Readonly<{ contentType?: string }>;
      customMetadata?: Readonly<Record<string, string>>;
    }>,
  ): Promise<unknown>;
}

export interface WorkerAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerExecutionContextBinding {
  waitUntil(promise: Promise<unknown>): void;
}

export type CloudflareEnvironment = Readonly<{
  DB: D1DatabaseBinding;
  SCENERY_CACHE?: R2BucketBinding;
  ASSETS: WorkerAssetsBinding;
  AMAP_WEB_SERVICE_KEY: string;
  AMAP_WEB_JS_KEY?: string;
  AMAP_JS_SECURITY_CODE?: string;
  ZHAOLU_SESSION_SECRET: string;
  AMAP_CITY?: string;
  AMAP_MAX_HTTP_ATTEMPTS_PER_PLAN?: string;
  AMAP_MAX_HTTP_ATTEMPTS_PER_MINUTE?: string;
  AMAP_ROUTE_EXPORTS_ALLOWED?: string;
  ZHAOLU_OPERATOR_NAME?: string;
  ZHAOLU_PRIVACY_CONTACT?: string;
  ZHAOLU_LOG_RETENTION_DAYS?: string;
  RATE_LIMIT_PLAN_PER_MINUTE?: string;
  RATE_LIMIT_SESSION_PER_HOUR?: string;
  RATE_LIMIT_USER_DATA_PER_MINUTE?: string;
}>;
