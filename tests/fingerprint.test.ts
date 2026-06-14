import { describe, expect, it } from "vitest";
import { buildRunFingerprint, formatFingerprint } from "../src/report.js";
import type { PinActionsConfig } from "../src/types.js";

describe("run fingerprints", () => {
  it("produces the same fingerprint for the same config and version", () => {
    const config = makeConfig();

    const first = buildRunFingerprint(config, "0.1.0");
    const second = buildRunFingerprint(config, "0.1.0");

    expect(second).toEqual(first);
  });

  it("changes when the config changes", () => {
    const baseline = buildRunFingerprint(makeConfig(), "0.1.0");
    const changed = buildRunFingerprint(
      makeConfig({
        include: [".github/workflows/release.yml"]
      }),
      "0.1.0"
    );

    expect(changed.fingerprint).not.toBe(baseline.fingerprint);
    expect(changed.configHash).not.toBe(baseline.configHash);
  });

  it("changes when the tool version changes", () => {
    const config = makeConfig();

    const first = buildRunFingerprint(config, "0.1.0");
    const second = buildRunFingerprint(config, "0.2.0");

    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.toolVersion).toBe("0.2.0");
  });

  it("uses lowercase hex strings for configHash and fingerprint", () => {
    const fingerprint = buildRunFingerprint(makeConfig(), "0.1.0");

    expect(fingerprint.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the config hash stable across repeated runs", () => {
    const config = makeConfig();
    const hashes = new Set(
      Array.from({ length: 10 }, () => buildRunFingerprint(config, "0.1.0").configHash)
    );

    expect(hashes.size).toBe(1);
  });

  it("formats fingerprint output consistently", () => {
    const fingerprint = {
      toolVersion: "0.1.0",
      configHash: "a".repeat(64),
      fingerprint: "b".repeat(64)
    };

    expect(formatFingerprint(fingerprint)).toBe(
      [
        "- Tool version: `0.1.0`",
        `- Config hash: \`${"a".repeat(64)}\``,
        `- Run fingerprint: \`${"b".repeat(64)}\``
      ].join("\n")
    );
  });
});

function makeConfig(overrides: Partial<PinActionsConfig> = {}): PinActionsConfig {
  return {
    mode: "fix",
    include: [".github/workflows/**/*.yml"],
    exclude: [],
    repos: [],
    includeRepos: [],
    excludeActions: [],
    excludeRepos: [],
    org: {
      includePrivate: false,
      includeArchived: false
    },
    pr: {
      create: true,
      branchPrefix: "chore/pin-actions",
      title: "Pin GitHub Actions to commit SHAs",
      labels: [],
      reviewers: [],
      assignees: []
    },
    enforcement: {
      enabled: false,
      failOnUnpinned: false,
      allowActions: [],
      exceptions: []
    },
    dependabot: {
      addVersionComments: true,
      commentFormat: "{ref}",
      generateConfigSnippet: false
    },
    ...overrides
  };
}
