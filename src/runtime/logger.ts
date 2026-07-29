import { normalizedRoutePath } from "./metrics.ts";

export type LogFields = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface RuntimeLogger {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export function safeRequestLogFields(input: Readonly<{
  method: string;
  pathname: string;
  status: number;
  durationMs: number;
  requestId?: string | null;
}>): LogFields {
  return {
    method: input.method,
    path: normalizedRoutePath(input.pathname),
    status: input.status,
    durationMs: Math.round(input.durationMs * 1_000) / 1_000,
    requestId: input.requestId ?? null,
  };
}

export function createJsonLogger(
  options: Readonly<{
    minimumLevel?: "info" | "error";
    write?: (line: string) => void;
    now?: () => string;
  }> = {},
): RuntimeLogger {
  const minimumLevel = options.minimumLevel ?? "info";
  const write =
    options.write ?? ((line: string) => process.stdout.write(line));
  const now =
    options.now ?? (() => new Date().toISOString());
  const emit = (
    level: "info" | "error",
    event: string,
    fields: LogFields = {},
  ) => {
    if (minimumLevel === "error" && level === "info") return;
    write(
      `${JSON.stringify({
        timestamp: now(),
        level,
        event,
        ...fields,
      })}\n`,
    );
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
