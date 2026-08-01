import assert from "node:assert/strict";
import test from "node:test";
import { runSecurityGate } from "../scripts/security-gate.ts";

function secureFiles(): Map<string, string> {
  return new Map([
    ["Dockerfile", "FROM node:24\nUSER node\n"],
    [
      "deploy/compose.staging.yaml",
      "services:\n  app:\n    image: example:${TAG}\n    read_only: true\n    cap_drop:\n      - ALL\n    security_opt:\n      - no-new-privileges:true\n",
    ],
    [
      ".github/workflows/ci.yml",
      "name: ci\npermissions:\n  contents: read\n",
    ],
    [
      ".env.example",
      "AMAP_WEB_SERVICE_KEY=\nZHAOLU_SESSION_SECRET=<placeholder>\n",
    ],
  ]);
}

test("passes tracked placeholders and hardened deployment files", () => {
  const result = runSecurityGate({ files: secureFiles() });
  assert.deepEqual(result, {
    status: "passed",
    scannedFileCount: 4,
    violations: [],
  });
});

test("reports credential material and weakened deployment invariants", () => {
  const files = secureFiles();
  files.set(".env", "AMAP_WEB_SERVICE_KEY=real-value");
  files.set(
    "config.ts",
    [
      "AMAP_WEB_SERVICE_KEY",
      ': "',
      "0123456789abcdef0123456789abcdef",
      '"',
    ].join(""),
  );
  files.set(
    "leak.txt",
    [
      ["-----BEGIN", " PRIVATE KEY-----"].join(""),
      ["AKIA", "1234567890ABCDEF"].join(""),
    ].join("\n"),
  );
  files.set("Dockerfile", "FROM node:24\nUSER root\n");
  files.set(
    "deploy/compose.staging.yaml",
    "services:\n  app:\n    image: example:latest\n",
  );
  files.set(".github/workflows/unsafe.yml", "name: unsafe\n");

  const result = runSecurityGate({ files });
  assert.equal(result.status, "failed");
  assert.deepEqual(
    result.violations.map(({ code }) => code).sort(),
    [
      "AWS_ACCESS_KEY_MATERIAL",
      "CONTAINER_NOT_NON_ROOT",
      "LITERAL_SECRET_ASSIGNMENT",
      "PRIVATE_KEY_MATERIAL",
      "STAGING_CAPABILITIES_NOT_DROPPED",
      "STAGING_MUTABLE_IMAGE_TAG",
      "STAGING_NOT_READ_ONLY",
      "STAGING_PRIVILEGE_ESCALATION",
      "TRACKED_ENV_FILE",
      "WORKFLOW_PERMISSIONS_MISSING",
    ].sort(),
  );
});
