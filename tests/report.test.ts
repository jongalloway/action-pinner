import { describe, expect, it } from "vitest";
import {
  buildRunFingerprint,
  collectEvidence,
  formatEvidence,
  formatFingerprint
} from "../src/report.js";
import type { FilePatch, PinEvidence, PinActionsConfig } from "../src/types.js";

describe("collectEvidence", () => {
  it("sorts evidence by filePath then line number", () => {
    const patches: FilePatch[] = [
      makePatch("z-workflow.yml", [
        makeEvidence("z-workflow.yml", 10),
        makeEvidence("z-workflow.yml", 2)
      ]),
      makePatch("a-workflow.yml", [makeEvidence("a-workflow.yml", 5)])
    ];

    const result = collectEvidence(patches);

    expect(result.map((e) => e.filePath)).toEqual([
      "a-workflow.yml",
      "z-workflow.yml",
      "z-workflow.yml"
    ]);
    expect(result[1].line).toBe(2);
    expect(result[2].line).toBe(10);
  });

  it("returns empty array for empty patches", () => {
    expect(collectEvidence([])).toEqual([]);
  });

  it("returns empty array for patches with no evidence", () => {
    const patches: FilePatch[] = [makePatch("file.yml", [])];
    expect(collectEvidence(patches)).toEqual([]);
  });

  it("flattens evidence from multiple patches", () => {
    const patches: FilePatch[] = [
      makePatch("a.yml", [makeEvidence("a.yml", 1)]),
      makePatch("b.yml", [makeEvidence("b.yml", 2), makeEvidence("b.yml", 3)])
    ];

    expect(collectEvidence(patches)).toHaveLength(3);
  });
});

describe("formatEvidence", () => {
  it("returns '- (none)' for empty patches", () => {
    expect(formatEvidence([])).toBe("- (none)");
  });

  it("returns '- (none)' for patches with no evidence", () => {
    expect(formatEvidence([makePatch("f.yml", [])])).toBe("- (none)");
  });

  it("formats each evidence entry on its own line", () => {
    const patches: FilePatch[] = [
      makePatch("a.yml", [makeEvidence("a.yml", 1), makeEvidence("a.yml", 5)])
    ];

    const result = formatEvidence(patches);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("a.yml:1");
    expect(lines[1]).toContain("a.yml:5");
  });

  it("includes original ref and resolved sha", () => {
    const patches: FilePatch[] = [
      makePatch("ci.yml", [
        makeEvidence("ci.yml", 10, "actions/checkout@v4", "abc123")
      ])
    ];

    const result = formatEvidence(patches);
    expect(result).toContain("actions/checkout@v4");
    expect(result).toContain("abc123");
  });
});

describe("buildRunFingerprint (additional)", () => {
  it("is stable regardless of config property insertion order", () => {
    const configA: PinActionsConfig = {
      mode: "fix",
      include: [],
      exclude: [],
      repos: [],
      includeRepos: [],
      excludeActions: [],
      excludeRepos: [],
      org: { includePrivate: false, includeArchived: false },
      pr: {
        create: true,
        branchPrefix: "x",
        title: "y",
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
      }
    };

    // Create same config with different property order
    const configB: PinActionsConfig = {
      exclude: [],
      mode: "fix",
      repos: [],
      include: [],
      includeRepos: [],
      excludeRepos: [],
      excludeActions: [],
      org: { includeArchived: false, includePrivate: false },
      enforcement: {
        exceptions: [],
        allowActions: [],
        failOnUnpinned: false,
        enabled: false
      },
      pr: {
        assignees: [],
        reviewers: [],
        labels: [],
        title: "y",
        branchPrefix: "x",
        create: true
      },
      dependabot: {
        generateConfigSnippet: false,
        commentFormat: "{ref}",
        addVersionComments: true
      }
    };

    const fpA = buildRunFingerprint(configA, "1.0.0");
    const fpB = buildRunFingerprint(configB, "1.0.0");
    expect(fpA.configHash).toBe(fpB.configHash);
    expect(fpA.fingerprint).toBe(fpB.fingerprint);
  });
});

describe("formatFingerprint", () => {
  it("includes all three fields in output", () => {
    const fp = {
      toolVersion: "2.0.0",
      configHash: "c".repeat(64),
      fingerprint: "d".repeat(64)
    };

    const result = formatFingerprint(fp);
    expect(result).toContain("2.0.0");
    expect(result).toContain("c".repeat(64));
    expect(result).toContain("d".repeat(64));
  });
});

// --- helpers ---

function makeEvidence(
  filePath: string,
  line: number,
  originalRef = "actions/checkout@v4",
  resolvedSha = "abc123def456"
): PinEvidence {
  return {
    filePath,
    line,
    originalRef,
    resolvedSha,
    sourceRepo: "actions/checkout",
    resolutionMethod: "commit",
    resolvedAt: "2024-01-01T00:00:00Z"
  };
}

function makePatch(filePath: string, evidence: PinEvidence[]): FilePatch {
  return {
    filePath,
    originalContent: "",
    updatedContent: "",
    referencesUpdated: [],
    evidence
  };
}
