import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parse } from "yaml";
import { scanWorkflows } from "./scanner.js";
import type { ActionReference } from "./types.js";

const DEFAULT_SNIPPET_LINES = [
  "version: 2",
  "updates:",
  "  - package-ecosystem: github-actions",
  "    directory: /",
  "    schedule:",
  "      interval: weekly"
];

const DEPENDABOT_CONFIG_PATHS = [
  ".github/dependabot.yml",
  ".github/dependabot.yaml"
];

export interface GenerateDependabotActionsSnippetOptions {
  includePatterns?: string[];
  cwd?: string;
  check?: boolean;
}

interface DependabotDirectoryEntry {
  directory: string;
  actions: string[];
}

export async function generateDependabotActionsSnippet(
  options: GenerateDependabotActionsSnippetOptions = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const result = await scanWorkflows(options.includePatterns ?? [], cwd);
  const entries = buildDependabotDirectoryEntries(result.references, cwd);
  const lines: string[] = [];

  if (options.check) {
    lines.push(...(await buildCheckComments(entries, cwd)));
    if (lines.length > 0) {
      lines.push("");
    }
  }

  if (entries.length === 0) {
    if (options.check) {
      lines.push("# No supported GitHub Action references were discovered; showing the default fallback snippet.");
      lines.push("");
    }
    lines.push(...DEFAULT_SNIPPET_LINES);
    return lines.join("\n");
  }

  lines.push("version: 2", "updates:");

  entries.forEach((entry, index) => {
    if (index > 0) {
      lines.push("");
    }

    lines.push(`  # Covers: ${entry.actions.join(", ")}`);
    lines.push("  - package-ecosystem: github-actions");
    lines.push(`    directory: ${entry.directory}`);
    lines.push("    schedule:");
    lines.push("      interval: weekly");
  });

  return lines.join("\n");
}

function buildDependabotDirectoryEntries(
  references: ActionReference[],
  cwd: string
): DependabotDirectoryEntry[] {
  const directories = new Map<string, Set<string>>();

  for (const reference of references) {
    const action = toDependabotActionName(reference);
    if (!action) {
      continue;
    }

    const directory = toDependabotDirectory(reference.filePath, cwd);
    const actions = directories.get(directory) ?? new Set<string>();
    actions.add(action);
    directories.set(directory, actions);
  }

  return [...directories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, actions]) => ({
      directory,
      actions: [...actions].sort((left, right) => left.localeCompare(right))
    }));
}

async function buildCheckComments(
  entries: DependabotDirectoryEntry[],
  cwd: string
): Promise<string[]> {
  const existing = await loadExistingDependabotConfig(cwd);
  const requiredDirectories = new Set(
    entries.length > 0 ? entries.map((entry) => entry.directory) : ["/"]
  );

  if (!existing) {
    return [
      "# No existing .github/dependabot.yml or .github/dependabot.yaml was found.",
      "# Add the snippet below to enable Dependabot updates for GitHub Actions."
    ];
  }

  if ("unreadable" in existing) {
    return [
      `# ${existing.displayPath} could not be parsed (malformed YAML); treating it as unreadable.`,
      "# Fix or replace it with the snippet below."
    ];
  }

  const missingDirectories = [...requiredDirectories]
    .filter((directory) => !existing.githubActionDirectories.has(directory))
    .sort((left, right) => left.localeCompare(right));

  if (missingDirectories.length === 0) {
    return [
      `# ${existing.displayPath} already covers all discovered GitHub Actions workflow directories.`
    ];
  }

  return [
    `# ${existing.displayPath} exists, but it is missing these github-actions directories:`,
    ...missingDirectories.map((directory) => `#   - ${directory}`)
  ];
}

async function loadExistingDependabotConfig(cwd: string): Promise<{
  displayPath: string;
  githubActionDirectories: Set<string>;
} | { displayPath: string; unreadable: true } | null> {
  for (const candidate of DEPENDABOT_CONFIG_PATHS) {
    const filePath = join(cwd, candidate);

    try {
      await access(filePath);
    } catch {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    let parsed: { updates?: unknown } | null;
    try {
      parsed = parse(content) as { updates?: unknown } | null;
    } catch {
      return { displayPath: candidate, unreadable: true };
    }
    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
    const githubActionDirectories = new Set<string>();

    for (const update of updates) {
      if (!update || typeof update !== "object") {
        continue;
      }

      const packageEcosystem = Reflect.get(update, "package-ecosystem");
      const directory = Reflect.get(update, "directory");

      if (packageEcosystem !== "github-actions" || typeof directory !== "string") {
        continue;
      }

      githubActionDirectories.add(normalizeDependabotDirectory(directory));
    }

    return {
      displayPath: candidate,
      githubActionDirectories
    };
  }

  return null;
}

function toDependabotActionName(reference: ActionReference): string | null {
  if (reference.kind === "docker" || reference.kind === "invalid" || reference.kind === "local") {
    return null;
  }

  const segments = reference.action.split("/");
  if (segments.length < 2) {
    return null;
  }

  return `${segments[0]}/${segments[1]}`;
}

function toDependabotDirectory(filePath: string, cwd: string): string {
  const normalizedPath = relative(cwd, dirname(filePath)).split(sep).join("/");
  return normalizeDependabotDirectory(normalizedPath === "" ? "/" : `/${normalizedPath}`);
}

function normalizeDependabotDirectory(directory: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized.startsWith("/") ? normalized : `/${normalized}`;
}
