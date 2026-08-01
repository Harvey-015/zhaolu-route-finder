import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type ReleasePhase = "closed-beta" | "public-beta";

export type ReleaseReadinessResult = Readonly<{
  status: "ready" | "not-ready";
  phase?: ReleasePhase;
  requiredGateCount: number;
  passedGateCount: number;
  approvalCount: number;
  blockingCodes: readonly string[];
}>;

const CLOSED_BETA_GATES = Object.freeze([
  "ci",
  "staging-smoke",
  "operations-smoke",
  "city-acceptance",
  "edge-load",
  "route-load",
  "security-review",
  "backup-restore-drill",
  "provider-authorization",
  "privacy-terms-review",
] as const);

const PUBLIC_BETA_GATES = Object.freeze([
  ...CLOSED_BETA_GATES,
  "closed-beta-observation",
  "incident-drill",
  "support-readiness",
  "legal-launch-review",
] as const);

const CLOSED_BETA_APPROVALS = Object.freeze([
  "engineering",
  "product",
  "operations",
  "privacy",
] as const);

const PUBLIC_BETA_APPROVALS = Object.freeze([
  ...CLOSED_BETA_APPROVALS,
  "legal",
] as const);

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validHttpsOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function validEvidenceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validCommitSha(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{40}$/.test(value) &&
    !/^0+$/.test(value)
  );
}

function validImageDigest(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(value) &&
    !/^sha256:0+$/.test(value)
  );
}

function add(blockers: Set<string>, code: string): void {
  blockers.add(code);
}

export function evaluateReleaseReadiness(
  value: unknown,
  options: Readonly<{
    now?: number;
    maximumEvidenceAgeDays?: number;
  }> = {},
): ReleaseReadinessResult {
  const blockers = new Set<string>();
  const root = objectValue(value);
  const phase =
    root?.phase === "closed-beta" || root?.phase === "public-beta"
      ? root.phase
      : undefined;
  if (root?.schemaVersion !== 1 || !phase) {
    add(blockers, "RELEASE_EVIDENCE_SCHEMA_INVALID");
  }
  const requiredGates = phase === "public-beta"
    ? PUBLIC_BETA_GATES
    : CLOSED_BETA_GATES;
  const requiredApprovals = phase === "public-beta"
    ? PUBLIC_BETA_APPROVALS
    : CLOSED_BETA_APPROVALS;
  const now = options.now ?? Date.now();
  const maximumEvidenceAgeDays = options.maximumEvidenceAgeDays ?? 14;
  if (
    !Number.isInteger(maximumEvidenceAgeDays) ||
    maximumEvidenceAgeDays < 1 ||
    maximumEvidenceAgeDays > 30
  ) {
    add(blockers, "RELEASE_EVIDENCE_MAX_AGE_INVALID");
  }
  const maximumAgeMs = maximumEvidenceAgeDays * 24 * 60 * 60_000;

  const release = objectValue(root?.release);
  if (
    !release ||
    !validCommitSha(release.commitSha) ||
    !validImageDigest(release.imageDigest) ||
    !validImageDigest(release.previousImageDigest) ||
    release.imageDigest === release.previousImageDigest ||
    !validHttpsOrigin(release.stagingOrigin) ||
    (phase === "public-beta" &&
      !validHttpsOrigin(release.productionOrigin)) ||
    !validTimestamp(release.plannedAt)
  ) {
    add(blockers, "RELEASE_ARTIFACT_INVALID");
  }

  const gateValues = Array.isArray(root?.gates) ? root.gates : [];
  const gates = new Map<string, Record<string, unknown>>();
  for (const value of gateValues) {
    const gate = objectValue(value);
    if (!gate || typeof gate.id !== "string" || gates.has(gate.id)) {
      add(blockers, "RELEASE_GATE_LIST_INVALID");
      continue;
    }
    gates.set(gate.id, gate);
  }
  let passedGateCount = 0;
  for (const id of requiredGates) {
    const gate = gates.get(id);
    if (!gate || gate.status !== "passed") {
      add(blockers, `RELEASE_GATE_${id.toUpperCase().replaceAll("-", "_")}_NOT_PASSED`);
      continue;
    }
    if (!validEvidenceUrl(gate.evidenceUrl) || !validTimestamp(gate.checkedAt)) {
      add(blockers, "RELEASE_GATE_EVIDENCE_INVALID");
      continue;
    }
    const checkedAt = Date.parse(gate.checkedAt);
    if (checkedAt > now + 5 * 60_000 || now - checkedAt > maximumAgeMs) {
      add(blockers, "RELEASE_GATE_EVIDENCE_STALE");
      continue;
    }
    passedGateCount += 1;
  }

  const approvalValues = Array.isArray(root?.approvals)
    ? root.approvals
    : [];
  const approvals = new Map<string, Record<string, unknown>>();
  for (const value of approvalValues) {
    const approval = objectValue(value);
    if (
      !approval ||
      typeof approval.role !== "string" ||
      approvals.has(approval.role)
    ) {
      add(blockers, "RELEASE_APPROVAL_LIST_INVALID");
      continue;
    }
    approvals.set(approval.role, approval);
  }
  let approvalCount = 0;
  for (const role of requiredApprovals) {
    const approval = approvals.get(role);
    if (
      !approval ||
      typeof approval.approver !== "string" ||
      !approval.approver.trim() ||
      !validTimestamp(approval.approvedAt) ||
      Date.parse(approval.approvedAt) > now + 5 * 60_000
    ) {
      add(
        blockers,
        `RELEASE_APPROVAL_${role.toUpperCase()}_MISSING`,
      );
      continue;
    }
    approvalCount += 1;
  }

  const risks = Array.isArray(root?.openRisks) ? root.openRisks : null;
  if (!risks) {
    add(blockers, "RELEASE_RISK_LIST_INVALID");
  } else {
    for (const value of risks) {
      const risk = objectValue(value);
      if (
        !risk ||
        (risk.severity !== "low" &&
          risk.severity !== "medium" &&
          risk.severity !== "high" &&
          risk.severity !== "critical")
      ) {
        add(blockers, "RELEASE_RISK_INVALID");
        continue;
      }
      if (risk.severity === "high" || risk.severity === "critical") {
        add(blockers, "RELEASE_HIGH_RISK_OPEN");
        continue;
      }
      if (
        typeof risk.owner !== "string" ||
        !risk.owner.trim() ||
        typeof risk.acceptedBy !== "string" ||
        !risk.acceptedBy.trim() ||
        !validTimestamp(risk.expiresAt) ||
        Date.parse(risk.expiresAt) <= now
      ) {
        add(blockers, "RELEASE_RISK_ACCEPTANCE_INVALID");
      }
    }
  }

  const blockingCodes = [...blockers].sort();
  return Object.freeze({
    status: blockingCodes.length === 0 ? "ready" : "not-ready",
    ...(phase ? { phase } : {}),
    requiredGateCount: requiredGates.length,
    passedGateCount,
    approvalCount,
    blockingCodes: Object.freeze(blockingCodes),
  });
}

function maximumEvidenceAgeDays(environment: NodeJS.ProcessEnv): number {
  const raw = environment.RELEASE_EVIDENCE_MAX_AGE_DAYS?.trim() || "14";
  const value = Number(raw);
  return Number.isInteger(value) ? value : Number.NaN;
}

export function runReleaseReadiness(
  environment: NodeJS.ProcessEnv = process.env,
): ReleaseReadinessResult {
  const root = resolve(process.cwd());
  const path = resolve(
    root,
    environment.RELEASE_EVIDENCE_FILE?.trim() ||
      "release/evidence.json",
  );
  try {
    const relativePath = relative(root, path);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath) ||
      !relativePath.endsWith(".json")
    ) {
      throw new Error("RELEASE_EVIDENCE_PATH_INVALID");
    }
    const value = JSON.parse(readFileSync(path, "utf8"));
    return evaluateReleaseReadiness(value, {
      maximumEvidenceAgeDays: maximumEvidenceAgeDays(environment),
    });
  } catch {
    return {
      status: "not-ready",
      requiredGateCount: CLOSED_BETA_GATES.length,
      passedGateCount: 0,
      approvalCount: 0,
      blockingCodes: ["RELEASE_EVIDENCE_FILE_INVALID"],
    };
  }
}

function main() {
  const result = runReleaseReadiness();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "ready") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
