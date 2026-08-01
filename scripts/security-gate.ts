import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type SecurityGateViolation = Readonly<{
  code: string;
  path: string;
}>;

export type SecurityGateResult = Readonly<{
  status: "passed" | "failed";
  scannedFileCount: number;
  violations: readonly SecurityGateViolation[];
}>;

const SAFE_ENV_FILES = new Set([".env.example", ".env.staging.example"]);
const SECRET_ENV_NAMES = new Set([
  "AMAP_WEB_SERVICE_KEY",
  "AMAP_WEB_JS_KEY",
  "AMAP_JS_SECURITY_CODE",
  "ZHAOLU_SESSION_SECRET",
  "ZHAOLU_OBSERVABILITY_TOKEN",
]);

function trackedTextFiles(root: string): ReadonlyMap<string, string> {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    },
  );
  const files = new Map<string, string>();
  for (const path of output.split("\0").filter(Boolean)) {
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
      continue;
    }
    const content = readFileSync(absolutePath);
    if (content.length > 2 * 1024 * 1024 || content.includes(0)) {
      continue;
    }
    files.set(path.replaceAll("\\", "/"), content.toString("utf8"));
  }
  return files;
}

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "");
  return (
    !normalized ||
    normalized.startsWith("${") ||
    normalized.startsWith("<") ||
    /placeholder|example|not-a-secret|at-least|^ci-|\btest\b|fake|dummy|server-only|public-web-key|incomplete|^short$/i.test(
      normalized,
    )
  );
}

export function scanSecurityFile(
  path: string,
  content: string,
): SecurityGateViolation[] {
  const violations: SecurityGateViolation[] = [];
  const add = (code: string) => violations.push({ code, path });
  if (
    /(?:^|\/)\.env(?:\.|$)/.test(path) &&
    !SAFE_ENV_FILES.has(path)
  ) {
    add("TRACKED_ENV_FILE");
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    add("PRIVATE_KEY_MATERIAL");
  }
  if (/\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(content)) {
    add("GITHUB_TOKEN_MATERIAL");
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(content)) {
    add("AWS_ACCESS_KEY_MATERIAL");
  }
  if (/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/.test(content)) {
    add("SLACK_WEBHOOK_MATERIAL");
  }
  const assignment = new RegExp(
    `\\b(?:${[...SECRET_ENV_NAMES].join("|")})[ \\t]*[:=][ \\t]*["']?([^"'\\\\[\\s$<{]{16,})`,
    "g",
  );
  for (const match of content.matchAll(assignment)) {
    if (!looksLikePlaceholder(match[1] ?? "")) {
      add("LITERAL_SECRET_ASSIGNMENT");
      break;
    }
  }
  if (SAFE_ENV_FILES.has(path)) {
    for (const line of content.split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1);
      if (SECRET_ENV_NAMES.has(name) && !looksLikePlaceholder(value)) {
        add("LITERAL_SECRET_IN_ENV_EXAMPLE");
      }
    }
  }
  return violations;
}

function deploymentViolations(
  files: ReadonlyMap<string, string>,
): SecurityGateViolation[] {
  const violations: SecurityGateViolation[] = [];
  const dockerfile = files.get("Dockerfile") ?? "";
  if (!/^USER node$/m.test(dockerfile)) {
    violations.push({ code: "CONTAINER_NOT_NON_ROOT", path: "Dockerfile" });
  }
  const staging = files.get("deploy/compose.staging.yaml") ?? "";
  const stagingRequirements = [
    ["read_only: true", "STAGING_NOT_READ_ONLY"],
    ["no-new-privileges:true", "STAGING_PRIVILEGE_ESCALATION"],
    ["cap_drop:", "STAGING_CAPABILITIES_NOT_DROPPED"],
  ] as const;
  for (const [required, code] of stagingRequirements) {
    if (!staging.includes(required)) {
      violations.push({ code, path: "deploy/compose.staging.yaml" });
    }
  }
  if (/image:\s*\S+:latest\b/.test(staging)) {
    violations.push({
      code: "STAGING_MUTABLE_IMAGE_TAG",
      path: "deploy/compose.staging.yaml",
    });
  }
  for (const [path, content] of files) {
    if (
      path.startsWith(".github/workflows/") &&
      (path.endsWith(".yml") || path.endsWith(".yaml")) &&
      !/^permissions:/m.test(content)
    ) {
      violations.push({ code: "WORKFLOW_PERMISSIONS_MISSING", path });
    }
  }
  return violations;
}

export function runSecurityGate(options: Readonly<{
  root?: string;
  files?: ReadonlyMap<string, string>;
}> = {}): SecurityGateResult {
  const files =
    options.files ?? trackedTextFiles(resolve(options.root ?? process.cwd()));
  const violations = [...files.entries()].flatMap(([path, content]) =>
    scanSecurityFile(path, content),
  );
  violations.push(...deploymentViolations(files));
  violations.sort((left, right) =>
    `${left.path}\0${left.code}`.localeCompare(`${right.path}\0${right.code}`),
  );
  return Object.freeze({
    status: violations.length === 0 ? "passed" : "failed",
    scannedFileCount: files.size,
    violations: Object.freeze(violations),
  });
}

function main() {
  const result = runSecurityGate();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
