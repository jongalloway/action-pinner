#!/usr/bin/env node
import { Command } from "commander";
import { simpleGit } from "simple-git";
import { loadConfig } from "./config.js";
import { generateDependabotActionsSnippet } from "./dependabot.js";
import { evaluateEnforcement } from "./enforcement.js";
import { pinReferences } from "./pinner.js";
import { createPullRequestBranch, publishPullRequest } from "./pr.js";
import { buildRunFingerprint, formatEvidence, formatFingerprint } from "./report.js";
import { ActionResolver } from "./resolver.js";
import { scanWorkflows } from "./scanner.js";
import { scanRepositories, type MultiRepoScanResult } from "./multi-repo-scanner.js";
import type {
  EnforcementException,
  EnforcementResult,
  FilePatch,
  PinActionsConfig,
  ScanResult
} from "./types.js";
import { AmbiguousRefError, UnresolvedRefError } from "./types.js";
import { getToolVersion } from "./version.js";
import { resolveWorkflowPatterns, toDisplayPath } from "./workflow-paths.js";
import { safeLog } from "./logging.js";
import { matchesPattern } from "./pattern-match.js";
import { filterRepositories, listOrgRepositories } from "./org.js";

export async function runCli(argv: string[] = process.argv.slice(2)) {
  const program = new Command();

  program
    .name("pin-actions")
    .description("Pin GitHub Action refs to immutable commit SHAs.")
    .version("0.1.0")
    .addHelpText(
      "after",
      `
SECURITY & TRUST

  Fail-Closed Behavior:
    If a ref cannot be resolved to a SHA, pin-actions fails (exit 1).
    Use --continue-on-error to skip unresolved refs (logged as warnings).

  Token Safety:
    Your GitHub token is never logged, even in verbose mode.
    All credential data is automatically redacted from logs.
    Use minimal scopes: contents:read for read-only, add pull_requests:write for PR creation.
    Never use: admin:repo_hook, admin:org, or full repo scopes.

  Deterministic Output:
    All scans and rewrites are stable across runs on the same input.
    Evidence fingerprints support audit trails and reproducible results.

EXAMPLES

  Scan for unpinned actions:
    $ pin-actions scan

  GitHub Enterprise Server:
    $ pin-actions scan --github-api-url https://enterprise.example.com/api/v3 --token $GHES_TOKEN

  Private repositories with .netrc:
    $ pin-actions scan --use-netrc

  Dry run to preview changes:
    $ pin-actions fix --dry-run

  Pin all unpinned actions:
    $ pin-actions fix

  Enforce policy in CI:
    $ pin-actions enforce

  Multi-repo targeting (discovery surface):
    $ pin-actions scan --github-org acme --include-repo "platform-*" --exclude-repo "*-archive"

  Filter workflow paths and actions:
    $ pin-actions scan --exclude-path ".github/workflows/legacy/**" --exclude-action "actions/cache"

  Open a PR with pinned updates:
    $ pin-actions pr --open

  Continue on errors:
    $ pin-actions scan --continue-on-error

AUTHENTICATION PRECEDENCE

  1. CLI --token flag
  2. PIN_ACTIONS_TOKEN environment variable
  3. .netrc file (if --use-netrc enabled)
  4. GITHUB_TOKEN environment variable (GitHub Actions)
  5. Anonymous (rate-limited to 60 requests/hour)

See SECURITY.md for detailed security guidance.
See docs/ENTERPRISE.md for enterprise deployments.
    `
    );

  program
    .command("scan")
    .option("--config <path>", "Path to .pin-actions.json", ".pin-actions.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--include-repo <pattern...>", "Include only repositories matching these patterns")
    .option("--exclude-repo <pattern...>", "Exclude repositories matching these patterns")
    .option("--json", "Emit JSON output", false)
    .option("--token <token>", "GitHub token for API authentication (overrides env vars)")
    .option("--github-api-url <url>", "GitHub API base URL (for GHES deployments)")
    .option("--use-netrc", "Use .netrc for authentication (if --token not provided)", false)
    .action(async (opts) => {
      const config = await loadConfig(opts.config);
      const include = resolveIncludePatterns(opts.path, config.include);
      const exclude = resolveExcludePatterns(opts.excludePath, config.exclude);
      const includeActions = resolveStringList(opts.includeAction, []);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const toolVersion = await getToolVersion();
      const fingerprint = buildRunFingerprint(config, toolVersion);
      const token = opts.token || process.env.PIN_ACTIONS_TOKEN || process.env.GITHUB_TOKEN;
      const targets = await resolveRepoTargets(opts, config, token);
      const requestedMultiRepo =
        Boolean(targets.org) ||
        targets.explicitRepositories.length > 0 ||
        targets.includePatterns.length > 0 ||
        targets.excludePatterns.length > 0;

      if (targets.repositories.length > 0) {
        const rawResult = await scanRepositories(targets.repositories, {
          includePatterns: include,
          excludePatterns: exclude,
          includeActions,
          excludeActions,
          token,
          githubApiUrl: opts.githubApiUrl || config.githubApiUrl
        });
        const result = applyEnforcementExceptionsToMultiRepo(
          rawResult,
          config.enforcement.exceptions
        );
        printMultiRepoScan(result, targets, fingerprint, Boolean(opts.json));
        return;
      }

      if (requestedMultiRepo) {
        printMultiRepoScan(
          {
            repositories: [],
            summary: {
              repositoriesScanned: 0,
              repositoriesWithUnpinned: 0,
              filesScanned: 0,
              referencesFound: 0,
              unpinnedFound: 0
            }
          },
          targets,
          fingerprint,
          Boolean(opts.json)
        );
        return;
      }

      const result = applyEnforcementExceptions(
        await scanWorkflows(include, process.cwd(), {
          excludePatterns: exclude,
          includeActions,
          excludeActions
        }),
        config.enforcement.exceptions
      );
      printScan(result, config, fingerprint, Boolean(opts.json));
    });

  program
    .command("fix")
    .option("--dry-run", "Do not write files", false)
    .option("--config <path>", "Path to .pin-actions.json", ".pin-actions.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--include-repo <pattern...>", "Include only repositories matching these patterns")
    .option("--exclude-repo <pattern...>", "Exclude repositories matching these patterns")
    .option("--continue-on-error", "Skip unresolved refs instead of failing", false)
    .option("--fail-on-ambiguous", "Fail on ambiguous refs (security mode)", false)
    .option("--token <token>", "GitHub token for API authentication (overrides env vars)")
    .option("--github-api-url <url>", "GitHub API base URL (for GHES deployments)")
    .option("--use-netrc", "Use .netrc for authentication (if --token not provided)", false)
    .action(async (opts) => {
      const config = await loadConfig(opts.config);
      const include = resolveIncludePatterns(opts.path, config.include);
      const exclude = resolveExcludePatterns(opts.excludePath, config.exclude);
      const includeActions = resolveStringList(opts.includeAction, []);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const result = applyEnforcementExceptions(
        await scanWorkflows(include, process.cwd(), {
          excludePatterns: exclude,
          includeActions,
          excludeActions
        }),
        config.enforcement.exceptions
      );
      const token = opts.token || process.env.PIN_ACTIONS_TOKEN || process.env.GITHUB_TOKEN;
      const resolver = new ActionResolver(token, undefined, {
        apiBaseUrl: opts.githubApiUrl || config.githubApiUrl,
        useNetrc: Boolean(opts.useNetrc || config.useNetrc),
        verbose: false
      });
      try {
        const patches = await pinReferences(
          result.unpinned,
          resolver,
          config,
          Boolean(opts.dryRun),
          {
            continueOnError: Boolean(opts.continueOnError),
            failOnAmbiguous: Boolean(opts.failOnAmbiguous)
          }
        );
        const toolVersion = await getToolVersion();
        const fingerprint = buildRunFingerprint(config, toolVersion);

        if (opts.dryRun) {
          console.log(
            `Dry run complete. ${patches.length} file(s) would be updated across ${countUpdatedReferences(patches)} reference(s).`
          );
          printDryRunPreview(patches, fingerprint);
        } else {
          console.log(
            `Updated ${patches.length} file(s) across ${countUpdatedReferences(patches)} reference(s).`
          );
          printEvidenceReport(patches);
          printRunFingerprint(fingerprint);
        }
      } catch (error) {
        if (error instanceof AmbiguousRefError || error instanceof UnresolvedRefError) {
          console.error(safeLog(`Error: ${error.message}`));
          console.error(safeLog(JSON.stringify(error.details, null, 2)));
          process.exitCode = 1;
        } else {
          throw error;
        }
      }
    });

  program
    .command("enforce")
    .option("--config <path>", "Path to .pin-actions.json", ".pin-actions.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--include-repo <pattern...>", "Include only repositories matching these patterns")
    .option("--exclude-repo <pattern...>", "Exclude repositories matching these patterns")
    .option("--allow-action <pattern...>", "Enforcement allowlist patterns")
    .option(
      "--exception <rule...>",
      "Enforcement exception rule: <action>[@ref][::workflow-glob]"
    )
    .option("--json", "Emit JSON output", false)
    .option("--continue-on-error", "Skip unresolved refs instead of failing", false)
    .option("--fail-on-ambiguous", "Fail on ambiguous refs (security mode)", false)
    .option("--token <token>", "GitHub token for API authentication (overrides env vars)")
    .option("--github-api-url <url>", "GitHub API base URL (for GHES deployments)")
    .option("--use-netrc", "Use .netrc for authentication (if --token not provided)", false)
    .action(async (opts) => {
      const config = await loadConfig(opts.config);
      const include = resolveIncludePatterns(opts.path, config.include);
      const exclude = resolveExcludePatterns(opts.excludePath, config.exclude);
      const allowActions = resolveStringList(opts.allowAction, config.enforcement.allowActions);
      const includeActions = resolveStringList(opts.includeAction, allowActions);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const exceptions = [
        ...config.enforcement.exceptions,
        ...parseExceptionRules(opts.exception)
      ];
      const scanResult = await scanWorkflows(include, process.cwd(), {
        excludePatterns: exclude,
        includeActions,
        excludeActions
      });
      const policy = { allowActions, exceptions };
      const result = evaluateEnforcement(scanResult, policy);
      const toolVersion = await getToolVersion();
      const fingerprint = buildRunFingerprint(config, toolVersion);
      printRepoTargetSummary(opts, config);
      printEnforcement(result, config, fingerprint, Boolean(opts.json));
      if (
        (result.violations.length > 0 || result.invalidExceptions.length > 0) &&
        config.enforcement.failOnUnpinned
      ) {
        process.exitCode = 1;
      }
    });

  program
    .command("pr")
    .option("--config <path>", "Path to .pin-actions.json", ".pin-actions.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--include-repo <pattern...>", "Include only repositories matching these patterns")
    .option("--exclude-repo <pattern...>", "Exclude repositories matching these patterns")
    .option("--continue-on-error", "Skip unresolved refs instead of failing", false)
    .option("--fail-on-ambiguous", "Fail on ambiguous refs (security mode)", false)
    .option("--token <token>", "GitHub token for API authentication (overrides env vars)")
    .option("--github-api-url <url>", "GitHub API base URL (for GHES deployments)")
    .option("--use-netrc", "Use .netrc for authentication (if --token not provided)", false)
    .action(async (opts) => {
      const config = await loadConfig(opts.config);
      const include = resolveIncludePatterns(opts.path, config.include);
      const exclude = resolveExcludePatterns(opts.excludePath, config.exclude);
      const includeActions = resolveStringList(opts.includeAction, []);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const result = applyEnforcementExceptions(
        await scanWorkflows(include, process.cwd(), {
          excludePatterns: exclude,
          includeActions,
          excludeActions
        }),
        config.enforcement.exceptions
      );
      const git = simpleGit();
      const token = opts.token || process.env.PIN_ACTIONS_TOKEN || process.env.GITHUB_TOKEN;
      const resolver = new ActionResolver(token, undefined, {
        apiBaseUrl: opts.githubApiUrl || config.githubApiUrl,
        useNetrc: Boolean(opts.useNetrc || config.useNetrc),
        verbose: false
      });
      try {
        const patches = await pinReferences(result.unpinned, resolver, config, false, {
          continueOnError: Boolean(opts.continueOnError),
          failOnAmbiguous: Boolean(opts.failOnAmbiguous)
        });
        const branch = await createPullRequestBranch({ config, patches, git });

        if (!config.pr.create) {
          console.log(
            `Created branch ${branch.branch} from ${branch.baseBranch} with ${patches.length} updated workflow file(s).`
          );
          console.log("PR creation is disabled by config.pr.create.");
          return;
        }

        const pullRequest = await publishPullRequest({
          config,
          patches,
          branch: branch.branch,
          baseBranch: branch.baseBranch,
          commitMessage: branch.commitMessage,
          token: token || process.env.GITHUB_TOKEN,
          git
        });

        if (!pullRequest) {
          return;
        }

        console.log(
          `Opened PR #${pullRequest.number}: ${pullRequest.htmlUrl} with ${patches.length} updated workflow file(s).`
        );
      } catch (error) {
        if (error instanceof AmbiguousRefError || error instanceof UnresolvedRefError) {
          console.error(safeLog(`Error: ${error.message}`));
          console.error(safeLog(JSON.stringify(error.details, null, 2)));
          process.exitCode = 1;
        } else {
          throw error;
        }
      }
    });

  program.command("dependabot-snippet").action(() => {
    console.log(generateDependabotActionsSnippet());
  });

  await program.parseAsync(["node", "pin-actions", ...argv]);
}

function resolveIncludePatterns(
  cliPaths: string[] | undefined,
  configInclude: string[]
): string[] {
  return resolveWorkflowPatterns(cliPaths ?? configInclude);
}

function resolveExcludePatterns(
  cliPaths: string[] | undefined,
  configExclude: string[]
): string[] {
  return resolveWorkflowPatterns(cliPaths ?? configExclude);
}

function resolveStringList(
  cliValues: string[] | undefined,
  configValues: string[]
): string[] {
  return cliValues ?? configValues;
}

interface RepoTargetingResult {
  org?: string;
  explicitRepositories: string[];
  includePatterns: string[];
  excludePatterns: string[];
  repositories: string[];
}

async function resolveRepoTargets(
  opts: {
    repo?: string[];
    githubOrg?: string;
    includeRepo?: string[];
    excludeRepo?: string[];
  },
  config: PinActionsConfig,
  token?: string
): Promise<RepoTargetingResult> {
  const org = opts.githubOrg ?? config.org.name;
  const explicitRepositories = opts.repo ?? config.repos;
  const includePatterns = opts.includeRepo ?? config.includeRepos;
  const excludePatterns = opts.excludeRepo ?? config.excludeRepos;
  const candidates = [...explicitRepositories];

  if (org) {
    const orgRepositories = await listOrgRepositories(
      {
        org,
        includePrivate: config.org.includePrivate,
        includeArchived: config.org.includeArchived
      },
      token
    );
    candidates.push(...orgRepositories);
  }

  const repositories = filterRepositories(candidates, {
    includePatterns,
    excludePatterns
  });

  return {
    org,
    explicitRepositories,
    includePatterns,
    excludePatterns,
    repositories
  };
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

function applyEnforcementExceptions(
  result: ScanResult,
  exceptions: EnforcementException[]
): ScanResult {
  if (exceptions.length === 0) {
    return result;
  }

  const unpinned = result.unpinned.filter((entry) => {
    return !exceptions.some((exception) => {
      if (!matchesPattern(entry.action, exception.action)) {
        return false;
      }
      if (exception.ref && (!entry.ref || !matchesPattern(entry.ref, exception.ref))) {
        return false;
      }
      if (exception.workflow && !matchesPattern(toDisplayPath(entry.filePath), exception.workflow)) {
        return false;
      }
      return true;
    });
  });

  return {
    ...result,
    summary: {
      ...result.summary,
      unpinnedFound: unpinned.length
    },
    unpinned
  };
}

function applyEnforcementExceptionsToMultiRepo(
  result: MultiRepoScanResult,
  exceptions: EnforcementException[]
): MultiRepoScanResult {
  if (exceptions.length === 0) {
    return result;
  }

  const repositories = result.repositories.map((entry) => ({
    ...entry,
    scan: applyEnforcementExceptions(entry.scan, exceptions)
  }));

  return {
    repositories,
    summary: {
      repositoriesScanned: repositories.length,
      repositoriesWithUnpinned: repositories.filter((entry) => entry.scan.unpinned.length > 0)
        .length,
      filesScanned: repositories.reduce((sum, entry) => sum + entry.scan.summary.filesScanned, 0),
      referencesFound: repositories.reduce((sum, entry) => sum + entry.scan.summary.referencesFound, 0),
      unpinnedFound: repositories.reduce((sum, entry) => sum + entry.scan.summary.unpinnedFound, 0)
    }
  };
}

function printRepoTargetSummary(
  opts: {
    repo?: string[];
    githubOrg?: string;
    includeRepo?: string[];
    excludeRepo?: string[];
  },
  config: PinActionsConfig
) {
  const repos = opts.repo ?? config.repos;
  const includeRepos = opts.includeRepo ?? config.includeRepos;
  const excludeRepos = opts.excludeRepo ?? config.excludeRepos;
  const githubOrg = opts.githubOrg ?? config.org.name;

  if (!githubOrg && repos.length === 0 && includeRepos.length === 0 && excludeRepos.length === 0) {
    return;
  }

  console.log("Repo targeting:");
  if (githubOrg) {
    console.log(`- org: ${githubOrg}`);
  }
  if (repos.length > 0) {
    console.log(`- explicit repos: ${repos.join(", ")}`);
  }
  if (includeRepos.length > 0) {
    console.log(`- include repo patterns: ${includeRepos.join(", ")}`);
  }
  if (excludeRepos.length > 0) {
    console.log(`- exclude repo patterns: ${excludeRepos.join(", ")}`);
  }
  console.log("- execution scope: current repository (multi-repo execution is planned)");
}

function printMultiRepoScan(
  result: MultiRepoScanResult,
  targets: RepoTargetingResult,
  fingerprint: ReturnType<typeof buildRunFingerprint>,
  json = false
) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          repositories: result.repositories,
          targeting: {
            org: targets.org,
            explicitRepositories: targets.explicitRepositories,
            includePatterns: targets.includePatterns,
            excludePatterns: targets.excludePatterns
          },
          run: fingerprint
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    `Scanned ${result.summary.repositoriesScanned} repositories (${result.summary.filesScanned} workflow file(s), ${result.summary.unpinnedFound} unpinned reference(s)).`
  );
  if (targets.org) {
    console.log(`Target org: ${targets.org}`);
  }
  if (targets.explicitRepositories.length > 0) {
    console.log(`Explicit repos: ${targets.explicitRepositories.join(", ")}`);
  }
  if (targets.includePatterns.length > 0) {
    console.log(`Include repo patterns: ${targets.includePatterns.join(", ")}`);
  }
  if (targets.excludePatterns.length > 0) {
    console.log(`Exclude repo patterns: ${targets.excludePatterns.join(", ")}`);
  }
  for (const entry of result.repositories) {
    console.log(
      `- ${entry.repository} [${entry.defaultBranch}] -> ${entry.scan.summary.unpinnedFound} unpinned of ${entry.scan.summary.referencesFound} reference(s)`
    );
    for (const ref of entry.scan.unpinned) {
      console.log(`  - ${ref.filePath}:${ref.line} -> ${ref.raw}`);
    }
  }

  printRunFingerprint(fingerprint);
}

function printScan(
  result: ScanResult,
  config: PinActionsConfig,
  fingerprint: ReturnType<typeof buildRunFingerprint>,
  json = false
) {
  if (json) {
    console.log(JSON.stringify(toScanOutput(result, fingerprint), null, 2));
    return;
  }

  if (result.unpinned.length === 0) {
    console.log("No unpinned actions found.");
    printRunFingerprint(fingerprint);
    return;
  }

  console.log(`Found ${result.unpinned.length} unpinned action reference(s):`);
  for (const entry of result.unpinned) {
    console.log(
      `- ${toDisplayPath(entry.filePath)}:${entry.line} -> ${entry.raw}`
    );
  }
  if (config.mode === "scan") {
    console.log("Run `pin-actions fix` to pin these references.");
  }

  printRunFingerprint(fingerprint);
}

function toScanOutput(
  result: ScanResult,
  fingerprint: ReturnType<typeof buildRunFingerprint>
) {
  return {
    summary: result.summary,
    references: result.references,
    unpinned: result.unpinned,
    run: fingerprint
  };
}

function printEnforcement(
  result: EnforcementResult,
  _config: PinActionsConfig,
  fingerprint: ReturnType<typeof buildRunFingerprint>,
  json = false
) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          references: result.references,
          allowed: result.allowed,
          violations: result.violations,
          invalidExceptions: result.invalidExceptions,
          compliant: result.compliant,
          run: fingerprint
        },
        null,
        2
      )
    );
    return;
  }

  if (result.invalidExceptions.length > 0) {
    console.log(`Invalid or expired exceptions:`);
    for (const issue of result.invalidExceptions) {
      console.log(`- ${issue.message}`);
    }
  }

  if (result.allowed.length > 0) {
    console.log(`Allowed (${result.allowed.length}):`);
    for (const entry of result.allowed) {
      console.log(`- ${toDisplayPath(entry.filePath)}:${entry.line} -> ${entry.raw}`);
    }
  }

  if (result.violations.length > 0) {
    console.log(`Violations:`);
    for (const entry of result.violations) {
      console.log(`- ${toDisplayPath(entry.filePath)}:${entry.line} -> ${entry.raw}`);
    }
  }

  if (result.violations.length === 0 && result.invalidExceptions.length === 0) {
    console.log("No enforcement violations.");
  } else {
    console.log("Enforcement failed.");
  }

  printRunFingerprint(fingerprint);
}

function countUpdatedReferences(patches: FilePatch[]): number {
  return patches.reduce((count, patch) => count + patch.referencesUpdated.length, 0);
}

function printDryRunPreview(
  patches: FilePatch[],
  fingerprint: ReturnType<typeof buildRunFingerprint>
) {
  if (patches.length === 0) {
    console.log("No changes would be made.");
    printRunFingerprint(fingerprint);
    return;
  }

  for (const patch of patches) {
    const originalLines = patch.originalContent.split(/\r?\n/);
    const updatedLines = patch.updatedContent.split(/\r?\n/);
    console.log(`\n--- ${toDisplayPath(patch.filePath)} ---`);

    const refs = [...patch.referencesUpdated].sort((a, b) => a.line - b.line);
    for (const ref of refs) {
      const lineIndex = ref.line - 1;
      const before = originalLines[lineIndex] ?? "";
      const after = updatedLines[lineIndex] ?? "";
      console.log(`@@ line ${ref.line} @@`);
      console.log(`- ${before}`);
      console.log(`+ ${after}`);
    }
  }

  printEvidenceReport(patches);
  printRunFingerprint(fingerprint);
}

function printRunFingerprint(fingerprint: ReturnType<typeof buildRunFingerprint>) {
  console.log("\nRun fingerprint:");
  console.log(formatFingerprint(fingerprint));
}

function printEvidenceReport(patches: FilePatch[]) {
  console.log("\nEvidence:");
  console.log(formatEvidence(patches));
}
