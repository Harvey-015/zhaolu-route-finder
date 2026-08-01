import { runBackupCommand } from "./backupCommand.ts";
import { pathToFileURL } from "node:url";

function intervalMilliseconds(
  environment: NodeJS.ProcessEnv,
): number {
  const raw =
    environment.ZHAOLU_BACKUP_INTERVAL_HOURS?.trim() || "24";
  const hours = Number(raw);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new RangeError("ZHAOLU_BACKUP_INTERVAL_HOURS_INVALID");
  }
  return hours * 60 * 60_000;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "DATABASE_BACKUP_FAILED";
}

export async function runBackupScheduler(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const intervalMs = intervalMilliseconds(environment);
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    while (!abortController.signal.aborted) {
      let waitMs = intervalMs;
      try {
        await runBackupCommand(environment);
      } catch (error) {
        waitMs = Math.min(intervalMs, 5 * 60_000);
        process.stderr.write(
          `${JSON.stringify({
            event: "database_backup_failed",
            errorCode: safeErrorCode(error),
            retryAfterSeconds: waitMs / 1_000,
          })}\n`,
        );
      }
      if (abortController.signal.aborted) break;
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, waitMs);
        abortController.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolveWait();
          },
          { once: true },
        );
      });
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runBackupScheduler();
}
