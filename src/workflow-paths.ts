import { relative, sep } from "node:path";

export const DEFAULT_WORKFLOW_PATTERNS = [
  ".github/workflows/**/*.yml",
  ".github/workflows/**/*.yaml"
];

const GLOB_PATTERN = /[*?[{]/;

export function resolveWorkflowPatterns(inputs: string[] = []): string[] {
  if (inputs.length === 0) {
    return DEFAULT_WORKFLOW_PATTERNS.map(normalizeWorkflowPattern);
  }

  return inputs.flatMap((input) => {
    const normalized = normalizeWorkflowPattern(input);
    if (GLOB_PATTERN.test(normalized) || isWorkflowFile(normalized)) {
      return [normalized];
    }

    const base = normalized.replace(/\/+$/, "");
    return [`${base}/**/*.yml`, `${base}/**/*.yaml`];
  });
}

export function normalizeWorkflowPattern(pattern: string): string {
  return pattern.replace(/\\/g, "/");
}

function isWorkflowFile(path: string): boolean {
  return path.endsWith(".yml") || path.endsWith(".yaml");
}

export function toDisplayPath(filePath: string, cwd = process.cwd()): string {
  return relative(cwd, filePath).split(sep).join("/");
}
