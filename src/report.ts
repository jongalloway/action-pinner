import { createHash } from "node:crypto";
import type { FilePatch, PinEvidence, PinActionsConfig } from "./types.js";
import { toDisplayPath } from "./workflow-paths.js";

export interface RunFingerprint {
  toolVersion: string;
  configHash: string;
  fingerprint: string;
}

export function buildRunFingerprint(
  config: PinActionsConfig,
  toolVersion: string
): RunFingerprint {
  const configHash = sha256(stableStringify(config));
  const fingerprint = sha256(`${toolVersion}\n${configHash}`);
  return {
    toolVersion,
    configHash,
    fingerprint
  };
}

export function collectEvidence(patches: FilePatch[]): PinEvidence[] {
  const evidence = patches.flatMap((patch) => patch.evidence);
  // Sort evidence by workflow path, line number, and ref for deterministic output
  return evidence.sort((a, b) => {
    const pathCmp = a.filePath.localeCompare(b.filePath);
    if (pathCmp !== 0) return pathCmp;
    return a.line - b.line;
  });
}

export function formatEvidence(patches: FilePatch[]): string {
  const evidence = collectEvidence(patches);
  if (evidence.length === 0) {
    return "- (none)";
  }

  return evidence.map(formatEvidenceEntry).join("\n");
}

export function formatFingerprint(fingerprint: RunFingerprint): string {
  return [
    `- Tool version: \`${fingerprint.toolVersion}\``,
    `- Config hash: \`${fingerprint.configHash}\``,
    `- Run fingerprint: \`${fingerprint.fingerprint}\``
  ].join("\n");
}

function formatEvidenceEntry(entry: PinEvidence): string {
  return `- ${toDisplayPath(entry.filePath)}:${entry.line} ${entry.originalRef} -> ${entry.resolvedSha} (source=${entry.sourceRepo}, method=${entry.resolutionMethod}, resolvedAt=${entry.resolvedAt})`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
