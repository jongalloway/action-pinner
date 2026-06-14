import { appendFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { evaluateEnforcement } from "./enforcement.js";
import { buildRunFingerprint } from "./report.js";
import { scanWorkflows } from "./scanner.js";
import type { EnforcementException } from "./types.js";
import { getToolVersion } from "./version.js";
import { resolveWorkflowPatterns } from "./workflow-paths.js";
import { runCli } from "./cli.js";

export async function runActionMode(): Promise<void> {
  const mode = process.env.INPUT_MODE ?? "scan";
  const configPath = process.env.INPUT_CONFIG ?? ".action-pinner.json";
  const args = buildCliArgs(mode, configPath);

  await runCli(args);

  if (mode === "enforce") {
    await writeEnforcementOutputs(configPath);
  }
}

function buildCliArgs(mode: string, configPath: string): string[] {
  const args = [mode, "--config", configPath];

  appendListFlag(args, "--path", parseListInput(process.env.INPUT_PATH));
  appendListFlag(args, "--exclude-path", parseListInput(process.env.INPUT_EXCLUDE_PATH));
  appendListFlag(args, "--include-action", parseListInput(process.env.INPUT_INCLUDE_ACTION));
  appendListFlag(args, "--exclude-action", parseListInput(process.env.INPUT_EXCLUDE_ACTION));

  if (mode === "enforce") {
    appendListFlag(args, "--allow-action", parseListInput(process.env.INPUT_ALLOW_ACTIONS));
    appendListFlag(args, "--exception", parseListInput(process.env.INPUT_EXCEPTION_RULES));
  }

  if (parseBooleanInput(process.env.INPUT_JSON)) {
    args.push("--json");
  }

  return args;
}

async function writeEnforcementOutputs(configPath: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const config = await loadConfig(configPath);
  const include = resolveWorkflowPatterns(parseListInput(process.env.INPUT_PATH) || config.include);
  const excludeInput = parseListInput(process.env.INPUT_EXCLUDE_PATH) ?? config.exclude;
  const exclude = excludeInput.length > 0 ? resolveWorkflowPatterns(excludeInput) : [];
  const includeActions = parseListInput(process.env.INPUT_INCLUDE_ACTION) ?? [];
  const excludeActions = parseListInput(process.env.INPUT_EXCLUDE_ACTION) ?? config.excludeActions;
  const allowActions = parseListInput(process.env.INPUT_ALLOW_ACTIONS) ?? config.enforcement.allowActions;
  const exceptions = [
    ...config.enforcement.exceptions,
    ...parseExceptionRules(parseListInput(process.env.INPUT_EXCEPTION_RULES))
  ];

  const result = evaluateEnforcement(
    await scanWorkflows(include, process.cwd(), {
      excludePatterns: exclude,
      includeActions,
      excludeActions
    }),
    {
      allowActions,
      exceptions
    }
  );
  const fingerprint = buildRunFingerprint(config, await getToolVersion());

  const lines = [
    `compliant=${result.compliant}`,
    `allowed_count=${result.summary.allowedCount}`,
    `violation_count=${result.summary.violationCount}`,
    `invalid_exception_count=${result.summary.invalidExceptionCount}`,
    `fingerprint=${fingerprint.fingerprint}`,
    `config_hash=${fingerprint.configHash}`
  ];

  await appendFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function appendListFlag(args: string[], flag: string, values?: string[]) {
  if (!values || values.length === 0) {
    return;
  }

  args.push(flag, ...values);
}

function parseListInput(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\r/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }

  const separator = normalized.includes("\n") ? /\n+/ : /,/;
  const values = normalized
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function parseBooleanInput(value?: string): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseExceptionRules(values: string[] | undefined): EnforcementException[] {
  if (!values || values.length === 0) {
    return [];
  }

  return values.map((rawRule) => {
    const [actionAndRef, workflow] = rawRule.split("::", 2);
    const [action, ref] = actionAndRef.split("@", 2);
    if (!action) {
      throw new Error(`Invalid enforcement exception rule '${rawRule}'. Expected <action>[@ref][::workflow-glob].`);
    }

    return {
      action,
      ref: ref || undefined,
      workflow: workflow || undefined
    };
  });
}
