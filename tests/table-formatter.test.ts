import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunFingerprint } from "../src/report.js";
import {
  formatEnforcementHtml,
  formatEnforcementMarkdown,
  formatEvidenceHtml,
  formatEvidenceMarkdown,
  formatEvidenceTable
} from "../src/table-formatter.js";
import type { EnforcementResult, PinEvidence } from "../src/types.js";

describe("table formatter", () => {
  it("aligns TTY table columns", () => {
    const output = formatEvidenceTable(makeEvidence());
    const lines = output.split("\n");
    const headerIndex = lines.findIndex(
      (line) =>
        line.startsWith("│") &&
        line.includes("Line") &&
        line.includes("Action") &&
        line.includes("Pinned SHA")
    );
    const header = lines[headerIndex];
    const [firstRow, secondRow] = lines
      .slice(headerIndex + 1)
      .filter((line) => line.startsWith("│"));

    const lineColumn = header.indexOf("Line");
    const actionColumn = header.indexOf("Action");
    const shaColumn = header.indexOf("Pinned SHA");

    expect(firstRow.indexOf("7")).toBe(lineColumn);
    expect(secondRow.indexOf("12")).toBe(lineColumn);
    expect(firstRow.indexOf("actions/checkout@v4")).toBe(actionColumn);
    expect(secondRow.indexOf("actions/setup-node@v4")).toBe(actionColumn);
    expect(firstRow.indexOf("34e11487")).toBe(shaColumn);
    expect(secondRow.indexOf("49933ea5")).toBe(shaColumn);
  });

  it("includes markdown commit links", () => {
    const output = formatEvidenceMarkdown(makeEvidence(), makeFingerprint());

    expect(output).toContain("| File | Line | Action | Pinned SHA | Commit |");
    expect(output).toContain("`34e11487abcdef0123456789abcdef01234567`");
    expect(output).toContain(
      "[View](https://github.com/actions/checkout/commit/34e11487abcdef0123456789abcdef01234567)"
    );
    expect(output).toContain("## Run fingerprint");
  });

  it("renders valid HTML with commit links", () => {
    const output = formatEvidenceHtml(makeEvidence(), makeFingerprint());

    expect(output).toContain("<!DOCTYPE html>");
    expect(output).toContain("<table>");
    expect(output).toContain('href="https://github.com/actions/setup-node/commit/49933ea5fedcba9876543210fedcba9876543210"');
    expect(output).toContain("<code>49933ea5fedcba9876543210fedcba9876543210</code>");
    expect(output).toContain("<h2>Run fingerprint</h2>");
  });

  it("uses render time for generated-at metadata", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-15T10:00:00.000Z"));

      const markdown = formatEvidenceMarkdown(makeEvidence(), makeFingerprint());
      const html = formatEvidenceHtml(makeEvidence(), makeFingerprint());

      expect(markdown).toContain("Generated at: 2026-06-15T10:00:00.000Z");
      expect(html).toContain("Generated at 2026-06-15T10:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives GHES commit URLs from githubApiUrl", () => {
    const [entry] = makeEvidence();
    const output = formatEvidenceMarkdown(
      [
        {
          ...entry,
          githubApiUrl: "https://github.contoso.com/api/v3"
        }
      ],
      makeFingerprint()
    );

    expect(output).toContain(
      "[View](https://github.contoso.com/actions/checkout/commit/34e11487abcdef0123456789abcdef01234567)"
    );
  });

  it("handles empty evidence cleanly", () => {
    expect(formatEvidenceTable([])).toBe("No pinned references found.");
    expect(formatEvidenceMarkdown([], makeFingerprint())).toContain("No pinned references found.");
    expect(formatEvidenceHtml([], makeFingerprint())).toContain("No pinned references found.");
  });

  it("renders enforcement markdown and html reports", () => {
    const markdown = formatEnforcementMarkdown(makeEnforcementResult(), makeFingerprint());
    const html = formatEnforcementHtml(makeEnforcementResult(), makeFingerprint());

    expect(markdown).toContain("# action-pinner enforce report");
    expect(markdown).toContain("actions/setup-node@v4");
    expect(markdown).toContain("| File | Line | Action |");
    expect(html).toContain("<title>action-pinner enforce report</title>");
    expect(html).toContain("<h1>action-pinner enforce report</h1>");
    expect(html).toContain("<code>actions/setup-node@v4</code>");
    expect(html).toContain("<table>");
  });
});

function makeEvidence(): PinEvidence[] {
  return [
    {
      filePath: resolve(process.cwd(), ".github", "workflows", "ci.yml"),
      line: 7,
      originalRef: "actions/checkout@v4",
      resolvedSha: "34e11487abcdef0123456789abcdef01234567",
      sourceRepo: "actions/checkout",
      resolutionMethod: "tag",
      resolvedAt: "2026-06-15T08:58:54.000Z",
      githubApiUrl: "https://api.github.com"
    },
    {
      filePath: resolve(process.cwd(), ".github", "workflows", "ci.yml"),
      line: 12,
      originalRef: "actions/setup-node@v4",
      resolvedSha: "49933ea5fedcba9876543210fedcba9876543210",
      sourceRepo: "actions/setup-node",
      resolutionMethod: "tag",
      resolvedAt: "2026-06-15T08:58:54.000Z",
      githubApiUrl: "https://api.github.com"
    }
  ];
}

function makeFingerprint(): RunFingerprint {
  return {
    toolVersion: "0.1.0",
    configHash: "a".repeat(64),
    fingerprint: "b".repeat(64)
  };
}

function makeEnforcementResult(): EnforcementResult {
  return {
    summary: {
      filesScanned: 1,
      referencesFound: 2,
      unpinnedFound: 2,
      allowedCount: 1,
      violationCount: 1,
      invalidExceptionCount: 1
    },
    references: [],
    allowed: [
      {
        filePath: resolve(process.cwd(), ".github", "workflows", "enforce.yml"),
        line: 4,
        raw: "actions/checkout@v4",
        action: "actions/checkout",
        ref: "v4",
        kind: "tag-or-branch",
        outcome: "allowed",
        reason: "allowlist",
        message: "Allowed by enforcement.allowActions pattern 'actions/*'."
      }
    ],
    violations: [
      {
        filePath: resolve(process.cwd(), ".github", "workflows", "enforce.yml"),
        line: 5,
        raw: "actions/setup-node@v4",
        action: "actions/setup-node",
        ref: "v4",
        kind: "tag-or-branch",
        outcome: "violation",
        reason: "unpinned",
        message: "Unpinned action reference is not covered by an allowlist entry or valid exception."
      }
    ],
    invalidExceptions: [
      {
        index: 0,
        reason: "expired",
        message: "Exception #1 expired at 2000-01-01.",
        exception: {
          action: "actions/setup-node",
          ref: "v4",
          workflow: "**/enforce.yml",
          expiresAt: "2000-01-01"
        }
      }
    ],
    compliant: false
  };
}
