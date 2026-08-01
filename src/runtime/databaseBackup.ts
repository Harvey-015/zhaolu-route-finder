import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { SQLITE_USER_DATA_SCHEMA_VERSION } from "../user-data/sqliteStore.ts";

export const BACKUP_METADATA_SCHEMA_VERSION = 1 as const;
export const BACKUP_METADATA_FILENAME = "last-success.json" as const;

export type BackupMetadata = Readonly<{
  schemaVersion: typeof BACKUP_METADATA_SCHEMA_VERSION;
  databaseSchemaVersion: number;
  createdAt: string;
  restoreVerifiedAt: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}>;

export type DatabaseVerification = Readonly<{
  databaseSchemaVersion: number;
  tableCounts: Readonly<{
    userSessions: number;
    savedRoutes: number;
    fieldReports: number;
  }>;
}>;

const BACKUP_FILENAME =
  /^zhaolu-\d{8}T\d{6}\.\d{3}Z\.sqlite$/;

function integerRow(
  database: DatabaseSync,
  sql: string,
  field: string,
): number {
  const row = database.prepare(sql).get() as
    | Record<string, unknown>
    | undefined;
  const value = row?.[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("DATABASE_VERIFICATION_INVALID_RESULT");
  }
  return value;
}

export function verifySqliteDatabase(
  path: string,
  expectedSchemaVersion = SQLITE_USER_DATA_SCHEMA_VERSION,
): DatabaseVerification {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const quickCheck = database.prepare("PRAGMA quick_check").get() as
      | { quick_check?: unknown }
      | undefined;
    if (quickCheck?.quick_check !== "ok") {
      throw new Error("DATABASE_QUICK_CHECK_FAILED");
    }
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("DATABASE_FOREIGN_KEY_CHECK_FAILED");
    }
    const databaseSchemaVersion = integerRow(
      database,
      "PRAGMA user_version",
      "user_version",
    );
    if (databaseSchemaVersion !== expectedSchemaVersion) {
      throw new Error("DATABASE_SCHEMA_VERSION_MISMATCH");
    }
    return Object.freeze({
      databaseSchemaVersion,
      tableCounts: Object.freeze({
        userSessions: integerRow(
          database,
          "SELECT COUNT(*) AS count FROM user_sessions",
          "count",
        ),
        savedRoutes: integerRow(
          database,
          "SELECT COUNT(*) AS count FROM saved_routes",
          "count",
        ),
        fieldReports: integerRow(
          database,
          "SELECT COUNT(*) AS count FROM field_reports",
          "count",
        ),
      }),
    });
  } finally {
    database.close();
  }
}

export function runRestoreDrill(
  backupPath: string,
  expectedSchemaVersion = SQLITE_USER_DATA_SCHEMA_VERSION,
): DatabaseVerification {
  const drillDirectory = mkdtempSync(
    join(tmpdir(), "zhaolu-restore-drill-"),
  );
  const restoredPath = join(drillDirectory, "restored.sqlite");
  try {
    copyFileSync(backupPath, restoredPath);
    return verifySqliteDatabase(
      restoredPath,
      expectedSchemaVersion,
    );
  } finally {
    rmSync(drillDirectory, { recursive: true, force: true });
  }
}

function sha256(path: string): string {
  return createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
}

function backupFilename(now: Date): string {
  return `zhaolu-${now.toISOString().replaceAll(":", "").replaceAll("-", "")}.sqlite`;
}

function removeExpiredBackups(
  backupDirectory: string,
  retentionDays: number,
  nowMs: number,
  currentFilename: string,
): number {
  const cutoff = nowMs - retentionDays * 24 * 60 * 60_000;
  let removed = 0;
  for (const entry of readdirSync(backupDirectory, {
    withFileTypes: true,
  })) {
    if (
      !entry.isFile() ||
      entry.name === currentFilename ||
      !BACKUP_FILENAME.test(entry.name)
    ) {
      continue;
    }
    const path = join(backupDirectory, entry.name);
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path);
      removed += 1;
    }
  }
  return removed;
}

export async function createVerifiedSqliteBackup(options: Readonly<{
  databasePath: string;
  backupDirectory: string;
  retentionDays: number;
  now?: () => Date;
}>): Promise<Readonly<{
  backupPath: string;
  metadata: BackupMetadata;
  removedExpiredBackups: number;
  verification: DatabaseVerification;
}>> {
  if (
    !Number.isInteger(options.retentionDays) ||
    options.retentionDays < 1 ||
    options.retentionDays > 365
  ) {
    throw new RangeError("BACKUP_RETENTION_DAYS_INVALID");
  }
  const databasePath = resolve(options.databasePath);
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    throw new Error("DATABASE_BACKUP_SOURCE_NOT_FOUND");
  }
  const backupDirectory = resolve(options.backupDirectory);
  mkdirSync(backupDirectory, { recursive: true });
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("BACKUP_TIME_INVALID");
  }
  const filename = backupFilename(now);
  const backupPath = join(backupDirectory, filename);
  const partialPath = join(
    backupDirectory,
    `.partial-${randomUUID()}.sqlite`,
  );
  if (existsSync(backupPath)) {
    throw new Error("DATABASE_BACKUP_ALREADY_EXISTS");
  }

  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    await backup(source, partialPath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  } finally {
    source.close();
  }

  try {
    verifySqliteDatabase(partialPath);
    renameSync(partialPath, backupPath);
    const verification = runRestoreDrill(backupPath);
    const metadata: BackupMetadata = Object.freeze({
      schemaVersion: BACKUP_METADATA_SCHEMA_VERSION,
      databaseSchemaVersion: verification.databaseSchemaVersion,
      createdAt: now.toISOString(),
      restoreVerifiedAt: now.toISOString(),
      filename,
      sizeBytes: statSync(backupPath).size,
      sha256: sha256(backupPath),
    });
    const metadataPath = join(
      backupDirectory,
      BACKUP_METADATA_FILENAME,
    );
    const removedExpiredBackups = removeExpiredBackups(
      backupDirectory,
      options.retentionDays,
      now.getTime(),
      filename,
    );
    writeFileSync(
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: "utf8" },
    );
    return Object.freeze({
      backupPath,
      metadata,
      removedExpiredBackups,
      verification,
    });
  } catch (error) {
    rmSync(partialPath, { force: true });
    rmSync(backupPath, { force: true });
    throw error;
  }
}

export function readBackupMetadata(
  backupDirectory: string,
): BackupMetadata | null {
  const metadataPath = join(
    resolve(backupDirectory),
    BACKUP_METADATA_FILENAME,
  );
  if (!existsSync(metadataPath)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BackupMetadata>;
  if (
    candidate.schemaVersion !== BACKUP_METADATA_SCHEMA_VERSION ||
    candidate.databaseSchemaVersion !==
      SQLITE_USER_DATA_SCHEMA_VERSION ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    typeof candidate.restoreVerifiedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.restoreVerifiedAt)) ||
    typeof candidate.filename !== "string" ||
    basename(candidate.filename) !== candidate.filename ||
    !BACKUP_FILENAME.test(candidate.filename) ||
    typeof candidate.sizeBytes !== "number" ||
    !Number.isInteger(candidate.sizeBytes) ||
    candidate.sizeBytes < 1 ||
    typeof candidate.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(candidate.sha256)
  ) {
    return null;
  }
  try {
    const backupStat = statSync(
      join(resolve(backupDirectory), candidate.filename),
    );
    if (
      !backupStat.isFile() ||
      backupStat.size !== candidate.sizeBytes
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return Object.freeze(candidate as BackupMetadata);
}
