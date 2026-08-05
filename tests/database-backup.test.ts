import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createVerifiedSqliteBackup,
  readBackupMetadata,
  runRestoreDrill,
  verifySqliteDatabase,
} from "../src/runtime/databaseBackup.ts";
import { SqliteUserDataStore } from "../src/user-data/sqliteStore.ts";

test("creates an online SQLite backup and passes an isolated restore drill", async () => {
  const root = mkdtempSync(join(tmpdir(), "zhaolu-backup-test-"));
  const databasePath = join(root, "data", "zhaolu.sqlite");
  const backupDirectory = join(root, "backups");
  mkdirSync(join(root, "data"));
  mkdirSync(backupDirectory);
  const store = new SqliteUserDataStore(databasePath);
  await store.createSession({
    userId: "11111111-1111-4111-8111-111111111111",
    expiresAt: Date.parse("2026-09-01T00:00:00.000Z"),
  });
  try {
    const oldBackup = join(
      backupDirectory,
      "zhaolu-20260701T000000.000Z.sqlite",
    );
    writeFileSync(oldBackup, "expired");
    const oldTime = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(oldBackup, oldTime, oldTime);

    const result = await createVerifiedSqliteBackup({
      databasePath,
      backupDirectory,
      retentionDays: 14,
      now: () => new Date("2026-08-01T00:00:00.000Z"),
    });

    assert.equal(existsSync(result.backupPath), true);
    assert.equal(result.removedExpiredBackups, 1);
    assert.equal(existsSync(oldBackup), false);
    assert.equal(result.verification.tableCounts.userSessions, 1);
    assert.equal(
      runRestoreDrill(result.backupPath).tableCounts.userSessions,
      1,
    );
    assert.deepEqual(
      readBackupMetadata(backupDirectory),
      result.metadata,
    );
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects corrupted backups and malformed success metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "zhaolu-backup-test-"));
  try {
    const corruptPath = join(root, "corrupt.sqlite");
    writeFileSync(corruptPath, "not sqlite");
    assert.throws(
      () => verifySqliteDatabase(corruptPath),
      /database|file is not a database/i,
    );
    writeFileSync(join(root, "last-success.json"), "{}");
    assert.equal(readBackupMetadata(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
