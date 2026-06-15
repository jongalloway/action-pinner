import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunFingerprint } from "../src/report.js";
import {
  formatEvidenceHtml,
  formatEvidenceMarkdown,
  formatEvidenceTable
} from "../src/table-formatter.js";
import type { PinEvidence } from "../src/types.js";

describe("table formatter", () => {
  it("aligns TTY table columns", () => {
    const output = formatEvidenceTable(makeEvidence());
    const [header, firstRow, secondRow] = output.split("\n");

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
    expect(output).toContain("`34e11487`");
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
    expect(output).toContain("<h2>Run fingerprint</h2>");
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
