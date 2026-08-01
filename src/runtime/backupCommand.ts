import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createVerifiedSqliteBackup } from "./databaseBackup.ts";

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    throw new RangeError(`${name}_INVALID`);
  }
  return value;
}

export async function runBackupCommand(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
) {
  const result = await createVerifiedSqliteBackup({
    databasePath: resolve(
      workingDirectory,
      environment.ZHAOLU_DATABASE_PATH?.trim() ||
        "data/zhaolu.sqlite",
    ),
    backupDirectory: resolve(
      workingDirectory,
      environment.ZHAOLU_BACKUP_DIRECTORY?.trim() || "backups",
    ),
    retentionDays: positiveInteger(
      environment,
      "ZHAOLU_BACKUP_RETENTION_DAYS",
      14,
    ),
  });
  process.stdout.write(
    `${JSON.stringify({
      event: "database_backup_verified",
      createdAt: result.metadata.createdAt,
      filename: result.metadata.filename,
      sizeBytes: result.metadata.sizeBytes,
      removedExpiredBackups: result.removedExpiredBackups,
    })}\n`,
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runBackupCommand();
}
