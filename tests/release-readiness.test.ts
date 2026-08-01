import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { evaluateReleaseReadiness } from "../scripts/release-readiness.ts";

const NOW = Date.parse("2026-08-10T00:00:00.000Z");
const CHECKED_AT = "2026-08-09T00:00:00.000Z";
const EVIDENCE_URL = "https://github.com/example/project/actions/runs/1";
const CLOSED_GATES = [
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
];

function readyEvidence(phase: "closed-beta" | "public-beta" = "closed-beta") {
  const publicGates = [
    "closed-beta-observation",
    "incident-drill",
    "support-readiness",
    "legal-launch-review",
  ];
  return {
    schemaVersion: 1,
    phase,
    release: {
      commitSha: "a".repeat(40),
      imageDigest: `sha256:${"b".repeat(64)}`,
      previousImageDigest: `sha256:${"c".repeat(64)}`,
      stagingOrigin: "https://staging.example.test",
      productionOrigin:
        phase === "public-beta" ? "https://routes.example.test" : null,
      plannedAt: "2026-08-12T00:00:00.000Z",
    },
    gates: [
      ...CLOSED_GATES,
      ...(phase === "public-beta" ? publicGates : []),
    ].map((id) => ({
      id,
      status: "passed",
      checkedAt: CHECKED_AT,
      evidenceUrl: EVIDENCE_URL,
    })),
    approvals: [
      "engineering",
      "product",
      "operations",
      "privacy",
      ...(phase === "public-beta" ? ["legal"] : []),
    ].map((role) => ({
      role,
      approver: `@${role}-owner`,
      approvedAt: CHECKED_AT,
    })),
    openRisks: [] as Array<{
      severity: string;
      owner: string;
      acceptedBy: string;
      expiresAt: string;
    }>,
  };
}

test("marks complete and current closed-beta evidence ready", () => {
  const result = evaluateReleaseReadiness(readyEvidence(), { now: NOW });
  assert.deepEqual(result, {
    status: "ready",
    phase: "closed-beta",
    requiredGateCount: 10,
    passedGateCount: 10,
    approvalCount: 4,
    blockingCodes: [],
  });
});

test("requires the additional public-beta gates and legal approval", () => {
  const evidence = readyEvidence("public-beta");
  evidence.gates = evidence.gates.filter(
    ({ id }) => id !== "closed-beta-observation",
  );
  evidence.approvals = evidence.approvals.filter(
    ({ role }) => role !== "legal",
  );
  const result = evaluateReleaseReadiness(evidence, { now: NOW });
  assert.equal(result.status, "not-ready");
  assert.ok(
    result.blockingCodes.includes(
      "RELEASE_GATE_CLOSED_BETA_OBSERVATION_NOT_PASSED",
    ),
  );
  assert.ok(
    result.blockingCodes.includes("RELEASE_APPROVAL_LEGAL_MISSING"),
  );
});

test("blocks stale evidence and open high risks", () => {
  const evidence = readyEvidence();
  evidence.gates[0].checkedAt = "2026-07-01T00:00:00.000Z";
  evidence.openRisks = [
    {
      severity: "high",
      owner: "@owner",
      acceptedBy: "@approver",
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
  ];
  const result = evaluateReleaseReadiness(evidence, { now: NOW });
  assert.equal(result.status, "not-ready");
  assert.ok(
    result.blockingCodes.includes("RELEASE_GATE_EVIDENCE_STALE"),
  );
  assert.ok(result.blockingCodes.includes("RELEASE_HIGH_RISK_OPEN"));
});

test("keeps the committed evidence template in an explicit No-Go state", () => {
  const template = JSON.parse(
    readFileSync(resolve("release/evidence.example.json"), "utf8"),
  );
  const result = evaluateReleaseReadiness(template, { now: NOW });
  assert.equal(result.status, "not-ready");
  assert.ok(result.blockingCodes.includes("RELEASE_ARTIFACT_INVALID"));
  assert.ok(result.blockingCodes.includes("RELEASE_GATE_CI_NOT_PASSED"));
});
