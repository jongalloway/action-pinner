import { readFile } from "node:fs/promises";
import fg from "fast-glob";
import type { ActionReference, ActionRefKind, ScanResult } from "./types.js";
import { matchesAnyPattern } from "./pattern-match.js";
import { resolveWorkflowPatterns } from "./workflow-paths.js";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export async function scanWorkflows(
  includePatterns: string[] = [],
  cwd = process.cwd(),
  options: {
    excludePatterns?: string[];
    includeActions?: string[];
    excludeActions?: string[];
  } = {}
): Promise<ScanResult> {
  const files = await fg(resolveWorkflowPatterns(includePatterns), {
    cwd,
    absolute: true,
    onlyFiles: true,
    dot: true,
    ignore: options.excludePatterns ?? []
  });
  const references: ActionReference[] = [];

  // Sort files for deterministic traversal
  const sortedFiles = files.sort();

  for (const filePath of sortedFiles) {
    const content = await readFile(filePath, "utf8");
    references.push(...extractActionReferences(filePath, content));
  }

  const filteredReferences = references
  .filter((reference) => {
    if (
      options.includeActions &&
      options.includeActions.length > 0 &&
      !matchesActionPattern(reference.action, options.includeActions)
    ) {
      return false;
    }

    if (
      options.excludeActions &&
      options.excludeActions.length > 0 &&
      matchesActionPattern(reference.action, options.excludeActions)
    ) {
      return false;
    }

    return true;
  });

  return buildScanResult(filteredReferences, sortedFiles.length);
}

export function buildScanResult(
  references: ActionReference[],
  filesScanned: number
): ScanResult {
  // Sort references by file path and then by line number for deterministic output
  const sortedReferences = references.sort((a, b) => {
    const pathCmp = a.filePath.localeCompare(b.filePath);
    if (pathCmp !== 0) return pathCmp;
    return a.line - b.line;
  });

  const unpinned = sortedReferences
    .filter((r) => r.kind === "tag-or-branch")
    .sort((a, b) => {
      const pathCmp = a.filePath.localeCompare(b.filePath);
      if (pathCmp !== 0) return pathCmp;
      return a.line - b.line;
    });

  return {
    summary: {
      filesScanned,
      referencesFound: sortedReferences.length,
      unpinnedFound: unpinned.length
    },
    references: sortedReferences,
    unpinned
  };
}

export function extractActionReferences(
  filePath: string,
  content: string
): ActionReference[] {
  const lines = content.split(/\r?\n/);
  const references: ActionReference[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\s*-?\s*uses:\s*(['"]?)([^'"#\s]+)\1/);
    if (!match) {
      continue;
    }

    const raw = match[2];
    const parsed = parseActionRef(raw);
    references.push({
      filePath,
      line: index + 1,
      column: match.index ? match.index + 1 : 1,
      raw,
      action: parsed.action,
      ref: parsed.ref,
      kind: classifyActionRef(raw, parsed.ref)
    });
  }

  return references;
}

function matchesActionPattern(action: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern) {
      return false;
    }

    // If only a repository name is provided (e.g. "cache"), match against the repo segment.
    const target = normalizedPattern.includes("/") ? action : action.split("/")[1] ?? action;
    return matchesAnyPattern(target, [normalizedPattern], { caseInsensitive: true });
  });
}

function parseActionRef(raw: string): { action: string; ref?: string } {
  if (raw.startsWith("docker://")) {
    return { action: raw };
  }

  if (raw.startsWith("./")) {
    return { action: raw };
  }

  const separator = raw.lastIndexOf("@");
  if (separator === -1) {
    return { action: raw };
  }

  return {
    action: raw.slice(0, separator),
    ref: raw.slice(separator + 1)
  };
}

function classifyActionRef(raw: string, ref?: string): ActionRefKind {
  if (raw.startsWith("docker://")) {
    return "docker";
  }

  if (raw.startsWith("./")) {
    return "local";
  }

  if (!raw.includes("@") || !ref) {
    return "invalid";
  }

  if (SHA_PATTERN.test(ref)) {
    return "pinned-sha";
  }

  return "tag-or-branch";
}
