import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EnforcementException, PinActionsConfig, ScanMode } from "./types.js";

const DEFAULT_CONFIG: PinActionsConfig = {
  mode: "scan",
  include: [],
  exclude: [],
  repos: [],
  includeRepos: [],
  excludeActions: [],
  excludeRepos: [],
  org: {
    includePrivate: true,
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
    failOnUnpinned: true,
    allowActions: [],
    exceptions: []
  },
  dependabot: {
    addVersionComments: true,
    generateConfigSnippet: false
  }
};

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "$schema",
  "mode",
  "include",
  "exclude",
  "repos",
  "includeRepos",
  "excludeActions",
  "excludeRepos",
  "org",
  "pr",
  "enforcement",
  "dependabot",
  "githubApiUrl",
  "useNetrc"
]);

export async function loadConfig(
  configPath = ".pin-actions.json"
): Promise<PinActionsConfig> {
  const path = resolve(configPath);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = parseConfig(raw, path);
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return structuredClone(DEFAULT_CONFIG);
    }

    throw new Error(message.startsWith("Invalid") ? message : `Failed to load config from ${path}: ${message}`);
  }
}

function parseConfig(raw: string, path: string): Partial<PinActionsConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid config in ${path}: expected a JSON object at the top level.`);
  }

  validateTopLevelKeys(parsed, path);

  return {
    mode: parseMode(parsed.mode, path),
    include: parseStringArray(parsed.include, "include", path),
    exclude: parseStringArray(parsed.exclude, "exclude", path),
    repos: parseStringArray(parsed.repos, "repos", path),
    includeRepos: parseStringArray(parsed.includeRepos, "includeRepos", path),
    excludeActions: parseStringArray(parsed.excludeActions, "excludeActions", path),
    excludeRepos: parseStringArray(parsed.excludeRepos, "excludeRepos", path),
    org: parseOrgConfig(parsed.org, path),
    pr: parsePrConfig(parsed.pr, path),
    enforcement: parseEnforcementConfig(parsed.enforcement, path),
    dependabot: parseDependabotConfig(parsed.dependabot, path),
    githubApiUrl: parsed.githubApiUrl === undefined ? undefined : parseString(parsed.githubApiUrl, path, "githubApiUrl"),
    useNetrc: parseBoolean(parsed.useNetrc, path, "useNetrc", false)
  };
}

function validateTopLevelKeys(value: Record<string, unknown>, path: string) {
  for (const key of Object.keys(value)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(
        `Invalid config in ${path}: unknown property '${key}'. Allowed properties are ${[
          ...ALLOWED_TOP_LEVEL_KEYS
        ].join(", ")}.`
      );
    }
  }
}

function parseMode(value: unknown, path: string): ScanMode {
  if (value === undefined) {
    return DEFAULT_CONFIG.mode;
  }

  if (!isString(value) || !["scan", "fix", "enforce", "pr"].includes(value)) {
    throw new Error(
      `Invalid config in ${path}: 'mode' must be one of scan, fix, enforce, or pr.`
    );
  }

  return value as ScanMode;
}

function parseStringArray(
  value: unknown,
  key: string,
  path: string,
  defaultValue: string[] = []
): string[] {
  if (value === undefined) {
    return [...defaultValue];
  }

  if (!Array.isArray(value) || value.some((item) => !isString(item))) {
    throw new Error(
      `Invalid config in ${path}: '${key}' must be an array of strings.`
    );
  }

  return [...value];
}

function parseOrgConfig(value: unknown, path: string): PinActionsConfig["org"] {
  if (value === undefined) {
    return structuredClone(DEFAULT_CONFIG.org);
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid config in ${path}: 'org' must be an object.`);
  }

  assertNoUnknownKeys(value, ["name", "includePrivate", "includeArchived"], path, "org");

  return {
    name: value.name === undefined ? undefined : parseString(value.name, path, "org.name"),
    includePrivate: parseBoolean(value.includePrivate, path, "org.includePrivate", DEFAULT_CONFIG.org.includePrivate),
    includeArchived: parseBoolean(value.includeArchived, path, "org.includeArchived", DEFAULT_CONFIG.org.includeArchived)
  };
}

function parsePrConfig(value: unknown, path: string): PinActionsConfig["pr"] {
  if (value === undefined) {
    return structuredClone(DEFAULT_CONFIG.pr);
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid config in ${path}: 'pr' must be an object.`);
  }

  assertNoUnknownKeys(
    value,
    ["create", "branchPrefix", "title", "labels", "reviewers", "assignees", "bodyTemplate"],
    path,
    "pr"
  );

  return {
    create: parseBoolean(value.create, path, "pr.create", DEFAULT_CONFIG.pr.create),
    branchPrefix: parseRequiredString(
      value.branchPrefix,
      path,
      "pr.branchPrefix",
      DEFAULT_CONFIG.pr.branchPrefix
    ),
    title: parseRequiredString(value.title, path, "pr.title", DEFAULT_CONFIG.pr.title),
    labels: parseStringArray(value.labels, "pr.labels", path),
    reviewers: parseStringArray(value.reviewers, "pr.reviewers", path),
    assignees: parseStringArray(value.assignees, "pr.assignees", path),
    bodyTemplate:
      value.bodyTemplate === undefined
        ? undefined
        : parseString(value.bodyTemplate, path, "pr.bodyTemplate")
  };
}

function parseEnforcementConfig(
  value: unknown,
  path: string
): PinActionsConfig["enforcement"] {
  if (value === undefined) {
    return structuredClone(DEFAULT_CONFIG.enforcement);
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid config in ${path}: 'enforcement' must be an object.`);
  }

  assertNoUnknownKeys(
    value,
    ["enabled", "failOnUnpinned", "allowActions", "exceptions"],
    path,
    "enforcement"
  );

  return {
    enabled: parseBoolean(value.enabled, path, "enforcement.enabled", DEFAULT_CONFIG.enforcement.enabled),
    failOnUnpinned: parseBoolean(
      value.failOnUnpinned,
      path,
      "enforcement.failOnUnpinned",
      DEFAULT_CONFIG.enforcement.failOnUnpinned
    ),
    allowActions: parseStringArray(value.allowActions, "enforcement.allowActions", path),
    exceptions: parseEnforcementExceptions(value.exceptions, path)
  };
}

function parseEnforcementExceptions(
  value: unknown,
  path: string
): EnforcementException[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid config in ${path}: 'enforcement.exceptions' must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `Invalid config in ${path}: 'enforcement.exceptions[${index}]' must be an object.`
      );
    }

    assertNoUnknownKeys(
      entry,
      ["action", "ref", "workflow", "reason", "justification", "expiresAt"],
      path,
      `enforcement.exceptions[${index}]`
    );

    if (!isString(entry.action)) {
      throw new Error(
        `Invalid config in ${path}: 'enforcement.exceptions[${index}].action' must be a string.`
      );
    }

    return {
      action: entry.action,
      ref: entry.ref === undefined ? undefined : parseString(entry.ref, path, `enforcement.exceptions[${index}].ref`),
      workflow:
        entry.workflow === undefined
          ? undefined
          : parseString(entry.workflow, path, `enforcement.exceptions[${index}].workflow`),
      reason:
        entry.reason === undefined
          ? undefined
          : parseString(entry.reason, path, `enforcement.exceptions[${index}].reason`),
      justification:
        entry.justification === undefined
          ? undefined
          : parseString(entry.justification, path, `enforcement.exceptions[${index}].justification`),
      expiresAt:
        entry.expiresAt === undefined
          ? undefined
          : parseString(entry.expiresAt, path, `enforcement.exceptions[${index}].expiresAt`)
    };
  });
}

function parseDependabotConfig(
  value: unknown,
  path: string
): PinActionsConfig["dependabot"] {
  if (value === undefined) {
    return structuredClone(DEFAULT_CONFIG.dependabot);
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid config in ${path}: 'dependabot' must be an object.`);
  }

  assertNoUnknownKeys(
    value,
    ["addVersionComments", "generateConfigSnippet"],
    path,
    "dependabot"
  );

  return {
    addVersionComments: parseBoolean(
      value.addVersionComments,
      path,
      "dependabot.addVersionComments",
      DEFAULT_CONFIG.dependabot.addVersionComments
    ),
    generateConfigSnippet: parseBoolean(
      value.generateConfigSnippet,
      path,
      "dependabot.generateConfigSnippet",
      DEFAULT_CONFIG.dependabot.generateConfigSnippet
    )
  };
}

function assertNoUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  path: string,
  section: string
) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(
        `Invalid config in ${path}: unknown property '${section}.${key}'.`
      );
    }
  }
}

function parseBoolean(
  value: unknown,
  path: string,
  key: string,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Invalid config in ${path}: '${key}' must be a boolean.`);
  }

  return value;
}

function parseRequiredString(
  value: unknown,
  path: string,
  key: string,
  defaultValue: string
): string {
  if (value === undefined) {
    return defaultValue;
  }

  if (!isString(value)) {
    throw new Error(`Invalid config in ${path}: '${key}' must be a string.`);
  }

  return value;
}

function parseString(value: unknown, path: string, key: string): string {
  if (!isString(value)) {
    throw new Error(`Invalid config in ${path}: '${key}' must be a string.`);
  }

  return value;
}

function mergeConfig(
  base: PinActionsConfig,
  incoming: Partial<PinActionsConfig>
): PinActionsConfig {
  return {
    ...base,
    ...incoming,
    org: {
      ...base.org,
      ...(incoming.org ?? {})
    },
    pr: {
      ...base.pr,
      ...(incoming.pr ?? {})
    },
    enforcement: {
      ...base.enforcement,
      ...(incoming.enforcement ?? {})
    },
    dependabot: {
      ...base.dependabot,
      ...(incoming.dependabot ?? {})
    },
    include: incoming.include ?? base.include,
    exclude: incoming.exclude ?? base.exclude,
    repos: incoming.repos ?? base.repos,
    includeRepos: incoming.includeRepos ?? base.includeRepos,
    excludeActions: incoming.excludeActions ?? base.excludeActions,
    excludeRepos: incoming.excludeRepos ?? base.excludeRepos,
    githubApiUrl: incoming.githubApiUrl ?? base.githubApiUrl,
    useNetrc: incoming.useNetrc !== undefined ? incoming.useNetrc : base.useNetrc
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
