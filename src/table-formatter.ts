import type { ActionReference, PinEvidence } from "./types.js";
import type { RunFingerprint } from "./report.js";
import { normalizeGithubApiUrl } from "./resolver.js";
import { toDisplayPath } from "./workflow-paths.js";

export function formatEvidenceTable(evidence: PinEvidence[]): string {
  const rows = sortEvidence(evidence);
  if (rows.length === 0) {
    return "No pinned references found.";
  }

  return formatAlignedTable(
    ["File", "Line", "Action", "Pinned SHA"],
    rows.map((entry) => [
      toDisplayPath(entry.filePath),
      String(entry.line),
      entry.originalRef,
      shortenSha(entry.resolvedSha)
    ])
  );
}

export function formatEvidenceMarkdownTable(evidence: PinEvidence[]): string {
  const rows = sortEvidence(evidence);
  if (rows.length === 0) {
    return "No pinned references found.";
  }
  return [
    "| File | Line | Action | Pinned SHA | Commit |",
    "|------|------|--------|------------|--------|",
    ...rows.map(
      (entry) =>
        `| ${escapeMarkdownCell(toDisplayPath(entry.filePath))} | ${entry.line} | ${escapeMarkdownCell(entry.originalRef)} | \`${shortenSha(entry.resolvedSha)}\` | [View](${buildCommitUrl(entry)}) |`
    )
  ].join("\n");
}

export function formatEvidenceMarkdown(
  evidence: PinEvidence[],
  fingerprint?: RunFingerprint
): string {
  const rows = sortEvidence(evidence);
  const body =
    rows.length === 0
      ? "No pinned references found."
      : [
          "| File | Line | Action | Pinned SHA | Commit |",
          "|------|------|--------|------------|--------|",
          ...rows.map(
            (entry) =>
              `| ${escapeMarkdownCell(toDisplayPath(entry.filePath))} | ${entry.line} | ${escapeMarkdownCell(entry.originalRef)} | \`${shortenSha(entry.resolvedSha)}\` | [View](${buildCommitUrl(entry)}) |`
          )
        ].join("\n");

  return [
    "# action-pinner report",
    "",
    `Generated at: ${rows[0]?.resolvedAt ?? new Date().toISOString()}`,
    "",
    body,
    formatFingerprintMarkdown(fingerprint)
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}

export function formatEvidenceHtml(
  evidence: PinEvidence[],
  fingerprint?: RunFingerprint
): string {
  const rows = sortEvidence(evidence);
  const generatedAt = rows[0]?.resolvedAt ?? new Date().toISOString();
  const tableMarkup =
    rows.length === 0
      ? '<p class="empty">No pinned references found.</p>'
      : [
          "<table>",
          "  <thead>",
          "    <tr>",
          "      <th>File</th>",
          "      <th>Line</th>",
          "      <th>Action</th>",
          "      <th>Pinned SHA</th>",
          "      <th>Commit</th>",
          "    </tr>",
          "  </thead>",
          "  <tbody>",
          ...rows.map((entry) => {
            const commitUrl = escapeHtml(buildCommitUrl(entry));
            return [
              "    <tr>",
              `      <td>${escapeHtml(toDisplayPath(entry.filePath))}</td>`,
              `      <td>${entry.line}</td>`,
              `      <td><code>${escapeHtml(entry.originalRef)}</code></td>`,
              `      <td><code>${escapeHtml(shortenSha(entry.resolvedSha))}</code></td>`,
              `      <td><a href="${commitUrl}">View commit</a></td>`,
              "    </tr>"
            ].join("\n");
          }),
          "  </tbody>",
          "</table>"
        ].join("\n");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>action-pinner report</title>",
    "  <style>",
    "    body { font-family: Arial, sans-serif; margin: 32px; color: #1f2328; background: #ffffff; }",
    "    h1, h2 { margin-bottom: 12px; }",
    "    .meta { color: #59636e; margin-bottom: 24px; }",
    "    table { border-collapse: collapse; width: 100%; margin-top: 16px; }",
    "    th, td { border: 1px solid #d0d7de; padding: 10px 12px; text-align: left; vertical-align: top; }",
    "    th { background: #f6f8fa; }",
    "    code { font-family: Consolas, 'Courier New', monospace; }",
    "    a { color: #0969da; text-decoration: none; }",
    "    a:hover { text-decoration: underline; }",
    "    .empty { padding: 16px; border: 1px solid #d0d7de; background: #f6f8fa; }",
    "    ul { padding-left: 20px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <header>",
    "    <h1>action-pinner report</h1>",
    `    <p class="meta">Generated at ${escapeHtml(generatedAt)}</p>`,
    "  </header>",
    `  ${tableMarkup}`,
    formatFingerprintHtml(fingerprint),
    "</body>",
    "</html>"
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}

export function formatUnpinnedTable(references: ActionReference[]): string {
  const rows = sortReferences(references);
  if (rows.length === 0) {
    return "No unpinned actions found.";
  }

  return formatAlignedTable(
    ["File", "Line", "Action"],
    rows.map((entry) => [toDisplayPath(entry.filePath), String(entry.line), entry.raw])
  );
}

export function formatUnpinnedMarkdown(
  references: ActionReference[],
  fingerprint?: RunFingerprint
): string {
  const rows = sortReferences(references);
  const body =
    rows.length === 0
      ? "No unpinned actions found."
      : [
          "| File | Line | Action |",
          "|------|------|--------|",
          ...rows.map(
            (entry) =>
              `| ${escapeMarkdownCell(toDisplayPath(entry.filePath))} | ${entry.line} | ${escapeMarkdownCell(entry.raw)} |`
          )
        ].join("\n");

  return [
    "# action-pinner scan report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    body,
    formatFingerprintMarkdown(fingerprint)
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}

export function formatUnpinnedHtml(
  references: ActionReference[],
  fingerprint?: RunFingerprint
): string {
  const rows = sortReferences(references);
  const tableMarkup =
    rows.length === 0
      ? '<p class="empty">No unpinned actions found.</p>'
      : [
          "<table>",
          "  <thead>",
          "    <tr>",
          "      <th>File</th>",
          "      <th>Line</th>",
          "      <th>Action</th>",
          "    </tr>",
          "  </thead>",
          "  <tbody>",
          ...rows.map((entry) =>
            [
              "    <tr>",
              `      <td>${escapeHtml(toDisplayPath(entry.filePath))}</td>`,
              `      <td>${entry.line}</td>`,
              `      <td><code>${escapeHtml(entry.raw)}</code></td>`,
              "    </tr>"
            ].join("\n")
          ),
          "  </tbody>",
          "</table>"
        ].join("\n");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>action-pinner scan report</title>",
    "  <style>",
    "    body { font-family: Arial, sans-serif; margin: 32px; color: #1f2328; background: #ffffff; }",
    "    h1, h2 { margin-bottom: 12px; }",
    "    .meta { color: #59636e; margin-bottom: 24px; }",
    "    table { border-collapse: collapse; width: 100%; margin-top: 16px; }",
    "    th, td { border: 1px solid #d0d7de; padding: 10px 12px; text-align: left; vertical-align: top; }",
    "    th { background: #f6f8fa; }",
    "    code { font-family: Consolas, 'Courier New', monospace; }",
    "    .empty { padding: 16px; border: 1px solid #d0d7de; background: #f6f8fa; }",
    "    ul { padding-left: 20px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <header>",
    "    <h1>action-pinner scan report</h1>",
    `    <p class="meta">Generated at ${escapeHtml(new Date().toISOString())}</p>`,
    "  </header>",
    `  ${tableMarkup}`,
    formatFingerprintHtml(fingerprint),
    "</body>",
    "</html>"
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}

function formatAlignedTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0))
  );

  return [headers, ...rows]
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd())
    .join("\n");
}

function buildCommitUrl(entry: PinEvidence): string {
  return `${deriveRepositoryBaseUrl(entry.githubApiUrl)}/${entry.sourceRepo}/commit/${entry.resolvedSha}`;
}

function deriveRepositoryBaseUrl(githubApiUrl?: string): string {
  if (!githubApiUrl) {
    return "https://github.com";
  }

  const normalized = normalizeGithubApiUrl(githubApiUrl);
  if (normalized === "https://api.github.com") {
    return "https://github.com";
  }

  return normalized.replace(/\/api\/v3$/, "");
}

function formatFingerprintMarkdown(fingerprint?: RunFingerprint): string {
  if (!fingerprint) {
    return "";
  }

  return [
    "",
    "## Run fingerprint",
    "",
    `- Tool version: \`${fingerprint.toolVersion}\``,
    `- Config hash: \`${fingerprint.configHash}\``,
    `- Run fingerprint: \`${fingerprint.fingerprint}\``
  ].join("\n");
}

function formatFingerprintHtml(fingerprint?: RunFingerprint): string {
  if (!fingerprint) {
    return "";
  }

  return [
    "  <section>",
    "    <h2>Run fingerprint</h2>",
    "    <ul>",
    `      <li>Tool version: <code>${escapeHtml(fingerprint.toolVersion)}</code></li>`,
    `      <li>Config hash: <code>${escapeHtml(fingerprint.configHash)}</code></li>`,
    `      <li>Run fingerprint: <code>${escapeHtml(fingerprint.fingerprint)}</code></li>`,
    "    </ul>",
    "  </section>"
  ].join("\n");
}

function sortEvidence(evidence: PinEvidence[]): PinEvidence[] {
  return [...evidence].sort((left, right) => {
    const pathComparison = left.filePath.localeCompare(right.filePath);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    const lineComparison = left.line - right.line;
    if (lineComparison !== 0) {
      return lineComparison;
    }

    return left.originalRef.localeCompare(right.originalRef);
  });
}

function sortReferences(references: ActionReference[]): ActionReference[] {
  return [...references].sort((left, right) => {
    const pathComparison = left.filePath.localeCompare(right.filePath);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    const lineComparison = left.line - right.line;
    if (lineComparison !== 0) {
      return lineComparison;
    }

    return left.raw.localeCompare(right.raw);
  });
}

function shortenSha(sha: string): string {
  return sha.slice(0, 8);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
