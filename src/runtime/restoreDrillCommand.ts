import { resolve } from "node:path";
import { runRestoreDrill } from "./databaseBackup.ts";

const backupFile = process.env.ZHAOLU_BACKUP_FILE?.trim();
if (!backupFile) {
  throw new RangeError("ZHAOLU_BACKUP_FILE_REQUIRED");
}
const verification = runRestoreDrill(resolve(backupFile));
process.stdout.write(
  `${JSON.stringify({
    event: "database_restore_drill_passed",
    databaseSchemaVersion: verification.databaseSchemaVersion,
    tableCounts: verification.tableCounts,
  })}\n`,
);
