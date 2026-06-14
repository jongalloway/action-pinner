import { readFile, writeFile } from "node:fs/promises";
import type {
  ActionReference,
  FilePatch,
  PinActionsConfig,
  PinEvidence,
  ResolutionResult
} from "./types.js";
import type { ActionResolver } from "./resolver.js";
import { buildResolutionKey } from "./resolver.js";

export async function pinReferences(
  references: ActionReference[],
  resolver: Pick<ActionResolver, "resolve">,
  config: PinActionsConfig,
  dryRun: boolean,
  options?: {
    continueOnError?: boolean;
    failOnAmbiguous?: boolean;
  }
): Promise<FilePatch[]> {
  const continueOnError = options?.continueOnError ?? false;
  const failOnAmbiguous = options?.failOnAmbiguous ?? false;

  const resolutions = await resolveReferences(references, resolver, {
    continueOnError,
    failOnAmbiguous
  });
  const grouped = groupByFile(references);
  const patches: FilePatch[] = [];

  // Process files in sorted order for deterministic output
  const sortedFilePaths = Array.from(grouped.keys()).sort();

  for (const filePath of sortedFilePaths) {
    const refs = grouped.get(filePath) ?? [];
    const original = await readFile(filePath, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);
    // Process in reverse line order for safe editing, but track updates for later sorting
    const sorted = [...refs].sort((a, b) => b.line - a.line);
    const updatedRefs: ActionReference[] = [];
    const evidence: PinEvidence[] = [];

    for (const ref of sorted) {
      if (!shouldResolve(ref)) {
        continue;
      }

      const resolution = resolutions.get(buildResolutionKey(ref));
      if (!resolution) {
        continue;
      }

      const versionComment = renderCommentTemplate(
        config.dependabot.commentFormat,
        ref,
        resolution.sha
      );

      const lineIndex = ref.line - 1;
      const line = lines[lineIndex] ?? "";
      const updatedLine = rewriteUsesLine(line, resolution.sha, {
        addVersionComment: config.dependabot.addVersionComments,
        comment: versionComment
      });

      lines[lineIndex] = updatedLine;
      updatedRefs.push(ref);
      evidence.push({
        filePath: ref.filePath,
        line: ref.line,
        originalRef: ref.raw,
        resolvedSha: resolution.sha,
        sourceRepo: resolution.sourceRepo,
        resolutionMethod: resolution.resolutionMethod,
        resolvedAt: resolution.resolvedAt
      });
    }

    const updatedContent = lines.join(eol);
    if (updatedContent === original) {
      continue;
    }

    if (!dryRun) {
      await writeFile(filePath, updatedContent, "utf8");
    }

    // Sort refs and evidence by line number for deterministic output
    const sortedUpdatedRefs = updatedRefs.sort((a, b) => a.line - b.line);
    const sortedEvidence = evidence.sort((a, b) => a.line - b.line);

    patches.push({
      filePath,
      originalContent: original,
      updatedContent,
      referencesUpdated: sortedUpdatedRefs,
      evidence: sortedEvidence
    });
  }

  // Sort patches by file path for deterministic output
  return patches.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function resolveReferences(
  references: ActionReference[],
  resolver: Pick<ActionResolver, "resolve">,
  options?: {
    continueOnError?: boolean;
    failOnAmbiguous?: boolean;
  }
): Promise<Map<string, ResolutionResult>> {
  const continueOnError = options?.continueOnError ?? false;
  const failOnAmbiguous = options?.failOnAmbiguous ?? false;

  const uniqueRefs = new Map<string, ActionReference>();
  for (const reference of references) {
    if (!shouldResolve(reference)) {
      continue;
    }

    uniqueRefs.set(buildResolutionKey(reference), reference);
  }

  const resolutions = new Map<string, ResolutionResult>();
  const promises = [...uniqueRefs.entries()].map(async ([key, reference]) => {
    try {
      const result = await resolver.resolve(reference);
      resolutions.set(key, result);
    } catch (error) {
      // If failOnAmbiguous is set and we have an AmbiguousRefError, re-throw it
      if (failOnAmbiguous && error instanceof Error && error.name === "AmbiguousRefError") {
        throw error;
      }
      // If continueOnError is not set and we have an UnresolvedRefError, re-throw it
      if (!continueOnError && error instanceof Error && error.name === "UnresolvedRefError") {
        throw error;
      }
      // If continueOnError is set, log the warning and continue
      if (continueOnError && error instanceof Error) {
        console.warn(`Skipping ref due to error: ${error.message}`);
      } else if (!continueOnError) {
        throw error;
      }
    }
  });

  await Promise.all(promises);

  return resolutions;
}

function shouldResolve(reference: ActionReference): boolean {
  const ref = reference.ref;
  return (
    reference.kind === "tag-or-branch" &&
    typeof ref === "string" &&
    !/^[0-9a-f]{40}$/i.test(ref)
  );
}

function groupByFile(
  references: ActionReference[]
): Map<string, ActionReference[]> {
  const grouped = new Map<string, ActionReference[]>();
  for (const reference of references) {
    const existing = grouped.get(reference.filePath);
    if (existing) {
      existing.push(reference);
      continue;
    }
    grouped.set(reference.filePath, [reference]);
  }
  return grouped;
}

function rewriteUsesLine(
  line: string,
  sha: string,
  options: { addVersionComment: boolean; comment: string }
): string {
  const match = line.match(/^(\s*-?\s*uses:\s*)(['"]?)([^'"#\s@]+)@([^'"#\s]+)(\2)(.*)$/);
  if (!match) {
    return line;
  }

  const [, prefix, quote, action, , closingQuote, suffix] = match;
  const renderedComment = options.comment.trim();
  const comment =
    options.addVersionComment && renderedComment.length > 0
      ? ` # ${renderedComment}`
      : "";
  return `${prefix}${quote}${action}@${sha}${closingQuote}${comment}${suffix}`;
}

function renderCommentTemplate(
  template: string,
  reference: Pick<ActionReference, "action" | "ref">,
  sha: string
): string {
  const shaShort = sha.slice(0, 7);
  return template.replace(/\{(ref|action|sha_short)\}/g, (_match, token) => {
    if (token === "ref") return reference.ref ?? "";
    if (token === "action") return reference.action;
    return shaShort;
  });
}
