import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  scanSecurityFile,
  type SecurityGateViolation,
} from "./security-gate.ts";

export type HistorySecurityEntry = Readonly<{
  objectId: string;
  path: string;
  content: string;
}>;

export type HistorySecurityViolation = SecurityGateViolation &
  Readonly<{ objectId: string }>;

export type HistorySecurityGateResult = Readonly<{
  status: "passed" | "failed";
  scannedBlobCount: number;
  violations: readonly HistorySecurityViolation[];
}>;

const MAX_TEXT_BLOB_BYTES = 2 * 1024 * 1024;

function git(
  root: string,
  args: readonly string[],
  options: Readonly<{ input?: string; encoding?: "utf8" }> = {},
): string | Buffer {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: options.encoding,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function historicalTextEntries(root: string): HistorySecurityEntry[] {
  const objectLines = String(
    git(root, ["rev-list", "--objects", "--all"], {
      encoding: "utf8",
    }),
  )
    .split(/\r?\n/)
    .filter(Boolean);
  const pathByObject = new Map<string, string>();
  for (const line of objectLines) {
    const separator = line.indexOf(" ");
    const objectId = separator < 0 ? line : line.slice(0, separator);
    if (!pathByObject.has(objectId)) {
      pathByObject.set(
        objectId,
        separator < 0 ? "<unknown>" : line.slice(separator + 1),
      );
    }
  }
  const objectIds = [...pathByObject.keys()];
  if (objectIds.length === 0) return [];
  const metadata = String(
    git(
      root,
      ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
      { input: `${objectIds.join("\n")}\n`, encoding: "utf8" },
    ),
  );
  const entries: HistorySecurityEntry[] = [];
  for (const line of metadata.split(/\r?\n/).filter(Boolean)) {
    const [objectId, type, sizeText] = line.split(" ");
    const size = Number(sizeText);
    if (
      !objectId ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size > MAX_TEXT_BLOB_BYTES
    ) {
      continue;
    }
    const content = git(root, ["cat-file", "blob", objectId]);
    if (!(content instanceof Buffer) || content.includes(0)) continue;
    entries.push({
      objectId,
      path: pathByObject.get(objectId) ?? "<unknown>",
      content: content.toString("utf8"),
    });
  }
  return entries;
}

export function runHistorySecurityGate(options: Readonly<{
  root?: string;
  entries?: readonly HistorySecurityEntry[];
}> = {}): HistorySecurityGateResult {
  const entries =
    options.entries ?? historicalTextEntries(resolve(options.root ?? process.cwd()));
  const violations = entries.flatMap(({ objectId, path, content }) =>
    scanSecurityFile(path, content).map((violation) => ({
      ...violation,
      objectId,
    })),
  );
  const uniqueViolations = [
    ...new Map(
      violations.map((violation) => [
        `${violation.objectId}\0${violation.path}\0${violation.code}`,
        violation,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.path}\0${left.code}\0${left.objectId}`.localeCompare(
      `${right.path}\0${right.code}\0${right.objectId}`,
    ),
  );
  return Object.freeze({
    status: uniqueViolations.length === 0 ? "passed" : "failed",
    scannedBlobCount: entries.length,
    violations: Object.freeze(uniqueViolations),
  });
}

function main() {
  const result = runHistorySecurityGate();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
