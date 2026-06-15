#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import type {
  EnforcementResult,
  EnforcementException,
  FilePatch,
  MultiRepoEnforcementResult,
  PinActionsConfig,
  ScanResult
} from "./types.js";
import { AmbiguousRefError, UnresolvedRefError } from "./types.js";
import type { MultiRepoScanResult } from "./multi-repo-scanner.js";
import type { RunFingerprint } from "./report.js";
import { getToolVersion } from "./version.js";
import { resolveWorkflowPatterns, toDisplayPath } from "./workflow-paths.js";
import { safeLog } from "./logging.js";
import type { RepositoryMetadata, RepositoryOwnerType } from "./org.js";

interface RunExecutionDetails {
  command: "scan" | "fix" | "pr" | "enforce";
  target: "local" | "multi-repo";
  output: "text" | "json";
  dryRun?: boolean;
  continueOnError?: boolean;
  failOnAmbiguous?: boolean;
  prCreate?: boolean;
}

export async function runCli(argv: string[] = process.argv.slice(2)) {
  const program = new Command();

  program
    .name("action-pinner")
    .description("Pin GitHub Action refs to immutable commit SHAs.")
    .version("0.1.0")
    .addHelpText(
      "after",
      `
SECURITY & TRUST

  Fail-Closed Behavior:
    If a ref cannot be resolved to a SHA, action-pinner fails (exit 1).
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
    $ action-pinner scan

  GitHub Enterprise Server:
    $ action-pinner scan --github-api-url https://enterprise.example.com/api/v3 --token $GHES_TOKEN

  Private repositories with .netrc:
    $ action-pinner scan --use-netrc

  Dry run to preview changes:
    $ action-pinner fix --dry-run

  Pin all unpinned actions:
    $ action-pinner fix

  Enforce policy in CI:
    $ action-pinner enforce

  Multi-repo targeting:
    $ action-pinner scan --github-org acme --include-repo "platform-*" --exclude-repo "*-archive"
    $ action-pinner scan --github-user octocat --include-repo "demo-*"

  Filter workflow paths and actions:
    $ action-pinner scan --exclude-path ".github/workflows/legacy/**" --exclude-action "actions/cache"

  Open a PR with pinned updates:
    $ action-pinner pr --open

  Continue on errors:
    $ action-pinner scan --continue-on-error

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
    .option("--config <path>", "Path to .action-pinner.json", ".action-pinner.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--github-user <user>", "User account to enumerate repositories from")
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
      const { buildRunFingerprint } = await import("./report.js");
      const toolVersion = await getToolVersion();
      const fingerprint = buildRunFingerprint(config, toolVersion);
      const token = opts.token || process.env.PIN_ACTIONS_TOKEN || process.env.GITHUB_TOKEN;
      const targets = await resolveRepoTargets(opts, config, token);
      const requestedMultiRepo =
        Boolean(targets.targetName) ||
        targets.explicitRepositories.length > 0 ||
        targets.includePatterns.length > 0 ||
        targets.excludePatterns.length > 0;

      if (targets.repositories.length > 0) {
        const [{ applyEnforcementExceptions }, { scanRepositories }] = await Promise.all([
          import("./enforcement.js"),
          import("./multi-repo-scanner.js")
        ]);
        const rawResult = await scanRepositories(targets.repositoryTargets, {
          includePatterns: include,
          excludePatterns: exclude,
          includeActions,
          excludeActions,
          token,
          githubApiUrl: opts.githubApiUrl || config.githubApiUrl
        });
        const result = applyEnforcementExceptionsToMultiRepo(
          rawResult,
          config.enforcement.exceptions,
          applyEnforcementExceptions
        );
        printMultiRepoScan(result, targets, fingerprint, {
          command: "scan",
          target: "multi-repo",
          output: opts.json ? "json" : "text"
        });
        return;
      }

      if (requestedMultiRepo) {
        printMultiRepoScan(
          {
            repositories: [],
            consolidated: {
              summary: {
                filesScanned: 0,
                referencesFound: 0,
                unpinnedFound: 0
              },
              references: [],
              unpinned: []
            },
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
          {
            command: "scan",
            target: "multi-repo",
            output: opts.json ? "json" : "text"
          }
        );
        return;
      }

      const [{ applyEnforcementExceptions }, { scanWorkflows }] = await Promise.all([
        import("./enforcement.js"),
        import("./scanner.js")
      ]);
      const result = applyEnforcementExceptions(
        await scanWorkflows(include, process.cwd(), {
          excludePatterns: exclude,
          includeActions,
          excludeActions
        }),
        config.enforcement.exceptions
      );
      printScan(result, config, fingerprint, {
        command: "scan",
        target: "local",
        output: opts.json ? "json" : "text"
      });
    });

  program
    .command("fix")
    .option("--dry-run", "Do not write files", false)
    .option("--config <path>", "Path to .action-pinner.json", ".action-pinner.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--github-user <user>", "User account to enumerate repositories from")
    .option("--include-repo <pattern...>", "Include only repositories matching these patterns")
    .option("--exclude-repo <pattern...>", "Exclude repositories matching these patterns")
    .option("--continue-on-error", "Skip unresolved refs instead of failing", false)
    .option("--fail-on-ambiguous", "Fail on ambiguous refs (security mode)", false)
    .option(
      "--comment-format <template>",
      "Version comment template; tokens: {ref}, {action}, {sha_short}"
    )
    .option("--token <token>", "GitHub token for API authentication (overrides env vars)")
    .option("--github-api-url <url>", "GitHub API base URL (for GHES deployments)")
    .option("--use-netrc", "Use .netrc for authentication (if --token not provided)", false)
    .action(async (opts) => {
      const config = applyCommentFormatOverride(await loadConfig(opts.config), opts.commentFormat);
      const include = resolveIncludePatterns(opts.path, config.include);
      const exclude = resolveExcludePatterns(opts.excludePath, config.exclude);
      const includeActions = resolveStringList(opts.includeAction, []);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const [
        { applyEnforcementExceptions },
        { pinReferences },
        { buildRunFingerprint, formatEvidence },
        { ActionResolver },
        { scanWorkflows }
      ] = await Promise.all([
        import("./enforcement.js"),
        import("./pinner.js"),
        import("./report.js"),
        import("./resolver.js"),
        import("./scanner.js")
      ]);
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
        const runDetails: RunExecutionDetails = {
          command: "fix",
          target: "local",
          output: "text",
          dryRun: Boolean(opts.dryRun),
          continueOnError: Boolean(opts.continueOnError),
          failOnAmbiguous: Boolean(opts.failOnAmbiguous)
        };

        if (opts.dryRun) {
          console.log(
            `Dry run complete. ${patches.length} file(s) would be updated across ${countUpdatedReferences(patches)} reference(s).`
          );
          printDryRunPreview(patches, fingerprint, runDetails, formatEvidence);
        } else {
          console.log(
            `Updated ${patches.length} file(s) across ${countUpdatedReferences(patches)} reference(s).`
          );
          printEvidenceReport(patches, formatEvidence);
          printRunFingerprint(fingerprint, runDetails);
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
    .option("--config <path>", "Path to .action-pinner.json", ".action-pinner.json")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--exclude-path <path...>", "Workflow file, directory, or glob to exclude")
    .option("--include-action <pattern...>", "Only include action refs matching these patterns")
    .option("--exclude-action <pattern...>", "Exclude action refs matching these patterns")
    .option("--repo <repo...>", "Explicit repository targets (owner/repo) for multi-repo scans")
    .option("--github-org <org>", "Organization to enumerate repositories from")
    .option("--github-user <user>", "User account to enumerate repositories from")
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
      const includeActions = resolveStringList(opts.includeAction, []);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const { buildRunFingerprint } = await import("./report.js");
      const exceptions = [
        ...config.enforcement.exceptions,
        ...parseExceptionRules(opts.exception)
      ];
      const token = opts.token || process.env.PIN_ACTIONS_TOKEN || process.env.GITHUB_TOKEN;
      const targets = await resolveRepoTargets(opts, config, token);
      const requestedMultiRepo =
        Boolean(targets.targetName) ||
        targets.explicitRepositories.length > 0 ||
        targets.includePatterns.length > 0 ||
        targets.excludePatterns.length > 0;
      const toolVersion = await getToolVersion();
      const fingerprint = buildRunFingerprint(config, toolVersion);
      const runDetails: RunExecutionDetails = {
        command: "enforce",
        target: targets.repositories.length > 0 || requestedMultiRepo ? "multi-repo" : "local",
        output: opts.json ? "json" : "text"
      };

      if (targets.repositories.length > 0) {
        const [{ evaluateMultiRepoEnforcement }, { scanRepositories }] = await Promise.all([
          import("./enforcement.js"),
          import("./multi-repo-scanner.js")
        ]);
        const rawResult = await scanRepositories(targets.repositoryTargets, {
          includePatterns: include,
          excludePatterns: exclude,
          includeActions,
          excludeActions,
          token,
          githubApiUrl: opts.githubApiUrl || config.githubApiUrl
        });
        const result = evaluateMultiRepoEnforcement(rawResult, {
          allowActions,
          exceptions
        });
        printMultiRepoEnforcement(result, targets, fingerprint, runDetails);
        if (!result.compliant && config.enforcement.failOnUnpinned) {
          process.exitCode = 1;
        }
        return;
      }

      if (requestedMultiRepo) {
        const { evaluateEnforcement } = await import("./enforcement.js");
        const emptyResult = evaluateEnforcement(
          {
            summary: {
              filesScanned: 0,
              referencesFound: 0,
              unpinnedFound: 0
            },
            references: [],
            unpinned: []
          },
          {
            allowActions,
            exceptions
          }
        );
        printMultiRepoEnforcement(
          {
            repositories: [],
            summary: {
              repositoriesScanned: 0,
              repositoriesWithViolations: 0,
              filesScanned: 0,
              referencesFound: 0,
              unpinnedFound: 0,
              allowedCount: 0,
              violationCount: 0,
              invalidExceptionCount: emptyResult.summary.invalidExceptionCount
            },
            invalidExceptions: emptyResult.invalidExceptions,
            compliant: emptyResult.compliant
          },
          targets,
          fingerprint,
          runDetails
        );
        if (!emptyResult.compliant && config.enforcement.failOnUnpinned) {
          process.exitCode = 1;
        }
        return;
      }

      const [{ evaluateEnforcement }, { scanWorkflows }] = await Promise.all([
        import("./enforcement.js"),
        import("./scanner.js")
      ]);
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
      printEnforcement(result, fingerprint, runDetails);
      if (!result.compliant && config.enforcement.failOnUnpinned) {
        process.exitCode = 1;
      }
    });

  program
    .command("pr")
    .option("--config <path>", "Path to .action-pinner.json", ".action-pinner.json")
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
    .option(
      "--comment-format <template>",
      "Version comment template; tokens: {ref}, {action}, {sha_short}"
    )
    .option("--token <token>", "GitHub token for API authentication (overrides env vars)")
    .option("--github-api-url <url>", "GitHub API base URL (for GHES deployments)")
    .option("--use-netrc", "Use .netrc for authentication (if --token not provided)", false)
    .action(async (opts) => {
      const config = applyCommentFormatOverride(await loadConfig(opts.config), opts.commentFormat);
      const include = resolveIncludePatterns(opts.path, config.include);
      const exclude = resolveExcludePatterns(opts.excludePath, config.exclude);
      const includeActions = resolveStringList(opts.includeAction, []);
      const excludeActions = resolveStringList(opts.excludeAction, config.excludeActions);
      const [
        { applyEnforcementExceptions },
        { pinReferences },
        { createPullRequestBranch, publishPullRequest },
        { buildRunFingerprint },
        { ActionResolver },
        { scanWorkflows },
        { simpleGit }
      ] = await Promise.all([
        import("./enforcement.js"),
        import("./pinner.js"),
        import("./pr.js"),
        import("./report.js"),
        import("./resolver.js"),
        import("./scanner.js"),
        import("simple-git")
      ]);
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
        const toolVersion = await getToolVersion();
        const fingerprint = buildRunFingerprint(config, toolVersion);
        const runDetails: RunExecutionDetails = {
          command: "pr",
          target: "local",
          output: "text",
          continueOnError: Boolean(opts.continueOnError),
          failOnAmbiguous: Boolean(opts.failOnAmbiguous),
          prCreate: config.pr.create
        };
        const branch = await createPullRequestBranch({ config, patches, git });

        if (!config.pr.create) {
          console.log(
            `Created branch ${branch.branch} from ${branch.baseBranch} with ${patches.length} updated workflow file(s).`
          );
          console.log("PR creation is disabled by config.pr.create.");
          printRunFingerprint(fingerprint, runDetails);
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
        printRunFingerprint(fingerprint, runDetails);
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
    .command("dependabot-snippet")
    .option("-p, --path <path...>", "Workflow file, directory, or glob to scan")
    .option("--check", "Compare the generated snippet against .github/dependabot.yml or .github/dependabot.yaml", false)
    .action(async (opts) => {
      const { generateDependabotActionsSnippet } = await import("./dependabot.js");
      console.log(
        await generateDependabotActionsSnippet({
          includePatterns: opts.path,
          check: opts.check
        })
      );
    });

  await program.parseAsync(["node", "action-pinner", ...argv]);
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
  const values = cliPaths ?? configExclude;
  return values.length === 0 ? [] : resolveWorkflowPatterns(values);
}

function resolveStringList(
  cliValues: string[] | undefined,
  configValues: string[]
): string[] {
  return cliValues ?? configValues;
}

interface RepoTargetingResult {
  targetName?: string;
  targetType?: RepositoryOwnerType;
  explicitRepositories: string[];
  includePatterns: string[];
  excludePatterns: string[];
  repositories: string[];
  repositoryTargets: Array<{ repository: string; defaultBranch?: string }>;
}

async function resolveRepoTargets(
  opts: {
    repo?: string[];
    githubOrg?: string;
    githubUser?: string;
    includeRepo?: string[];
    excludeRepo?: string[];
    githubApiUrl?: string;
  },
  config: PinActionsConfig,
  token?: string
): Promise<RepoTargetingResult> {
  if (opts.githubOrg && opts.githubUser) {
    throw new Error("Specify either --github-org or --github-user, not both.");
  }

  const targetName = opts.githubUser ?? opts.githubOrg ?? config.org.name;
  const targetType: RepositoryOwnerType | undefined = opts.githubUser
    ? "user"
    : opts.githubOrg
      ? "org"
      : config.org.name
        ? config.org.type ?? "org"
        : undefined;
  const explicitRepositories = opts.repo ?? config.repos;
  const includePatterns = opts.includeRepo ?? config.includeRepos;
  const excludePatterns = opts.excludeRepo ?? config.excludeRepos;
  const candidates: RepositoryMetadata[] = explicitRepositories.map((repository) => ({
    fullName: repository,
    defaultBranch: "",
    archived: false
  }));

  if (targetName || candidates.length > 0) {
    const { filterRepositoryMetadata, listOwnerRepositories } = await import("./org.js");

    if (targetName && targetType) {
      const discoveredRepositories = await listOwnerRepositories(
        {
          target: targetName,
          targetType,
          includePrivate: config.org.includePrivate,
          includeArchived: config.org.includeArchived,
          githubApiUrl: opts.githubApiUrl || config.githubApiUrl
        },
        token
      );
      candidates.push(...discoveredRepositories);
    }

    const repositories = filterRepositoryMetadata(candidates, {
      includePatterns,
      excludePatterns
    });

    return {
      targetName,
      targetType,
      explicitRepositories,
      includePatterns,
      excludePatterns,
      repositories: repositories.map((repository) => repository.fullName),
      repositoryTargets: repositories.map((repository) => ({
        repository: repository.fullName,
        defaultBranch: repository.defaultBranch || undefined
      }))
    };
  }

  return {
    targetName,
    targetType,
    explicitRepositories,
    includePatterns,
    excludePatterns,
    repositories: [],
    repositoryTargets: []
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

function applyEnforcementExceptionsToMultiRepo(
  result: MultiRepoScanResult,
  exceptions: EnforcementException[],
  applyEnforcementExceptions: (
    result: ScanResult,
    exceptions: EnforcementException[]
  ) => ScanResult
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
    consolidated: applyEnforcementExceptions(result.consolidated, exceptions),
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

function printMultiRepoScan(
  result: MultiRepoScanResult,
  targets: RepoTargetingResult,
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  if (runDetails.output === "json") {
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          consolidated: result.consolidated,
          repositories: result.repositories,
          targeting: {
            targetName: targets.targetName,
            targetType: targets.targetType,
            explicitRepositories: targets.explicitRepositories,
            includePatterns: targets.includePatterns,
            excludePatterns: targets.excludePatterns
          },
          run: toRunOutput(fingerprint, runDetails)
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
  if (targets.targetName && targets.targetType) {
    console.log(`Target ${targets.targetType}: ${targets.targetName}`);
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
  if (result.consolidated.unpinned.length > 0) {
    console.log("Consolidated findings:");
    for (const ref of result.consolidated.unpinned) {
      console.log(`- ${ref.filePath}:${ref.line} -> ${ref.raw}`);
    }
  }
  for (const entry of result.repositories) {
    console.log(
      `- ${entry.repository} [${entry.defaultBranch}] -> ${entry.scan.summary.unpinnedFound} unpinned of ${entry.scan.summary.referencesFound} reference(s)`
    );
    for (const ref of entry.scan.unpinned) {
      console.log(`  - ${ref.filePath}:${ref.line} -> ${ref.raw}`);
    }
  }

  printRunFingerprint(fingerprint, runDetails);
}

function printMultiRepoEnforcement(
  result: MultiRepoEnforcementResult,
  targets: RepoTargetingResult,
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  if (runDetails.output === "json") {
    console.log(
      JSON.stringify(
        {
          compliant: result.compliant,
          summary: result.summary,
          invalidExceptions: result.invalidExceptions,
          repositories: result.repositories,
          targeting: {
            targetName: targets.targetName,
            targetType: targets.targetType,
            explicitRepositories: targets.explicitRepositories,
            includePatterns: targets.includePatterns,
            excludePatterns: targets.excludePatterns
          },
          run: toRunOutput(fingerprint, runDetails)
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    result.compliant
      ? `Enforcement passed across ${result.summary.repositoriesScanned} repositories.`
      : `Enforcement failed across ${result.summary.repositoriesScanned} repositories.`
  );
  console.log(
    `Allowed ${result.summary.allowedCount} reference(s); found ${result.summary.violationCount} violation(s); ${result.summary.invalidExceptionCount} invalid or expired exception(s).`
  );
  if (targets.targetName && targets.targetType) {
    console.log(`Target ${targets.targetType}: ${targets.targetName}`);
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

  if (result.invalidExceptions.length > 0) {
    console.log("\nInvalid or expired exceptions:");
    for (const issue of result.invalidExceptions) {
      console.log(`- ${issue.message}`);
    }
  }

  for (const entry of result.repositories) {
    console.log(
      `\n- ${entry.repository} [${entry.defaultBranch}] -> ${entry.enforcement.summary.allowedCount} allowed, ${entry.enforcement.summary.violationCount} violation(s)`
    );
    printEnforcementSections(entry.enforcement, "  ", { includeInvalidExceptions: false });
  }

  printRunFingerprint(fingerprint, runDetails);
}

function printScan(
  result: ScanResult,
  config: PinActionsConfig,
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  if (runDetails.output === "json") {
    console.log(JSON.stringify(toScanOutput(result, fingerprint, runDetails), null, 2));
    return;
  }

  if (result.unpinned.length === 0) {
    console.log("No unpinned actions found.");
    printRunFingerprint(fingerprint, runDetails);
    return;
  }

  console.log(`Found ${result.unpinned.length} unpinned action reference(s):`);
  for (const entry of result.unpinned) {
    console.log(
      `- ${toDisplayPath(entry.filePath)}:${entry.line} -> ${entry.raw}`
    );
  }
  if (runDetails.command === "scan") {
    console.log("Run `action-pinner fix` to pin these references.");
  }

  printRunFingerprint(fingerprint, runDetails);
}

function printEnforcement(
  result: EnforcementResult,
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  if (runDetails.output === "json") {
    console.log(JSON.stringify(toEnforcementOutput(result, fingerprint, runDetails), null, 2));
    return;
  }

  console.log(
    result.compliant
      ? "Enforcement passed."
      : "Enforcement failed."
  );
  console.log(
    `Allowed ${result.summary.allowedCount} reference(s); found ${result.summary.violationCount} violation(s); ${result.summary.invalidExceptionCount} invalid or expired exception(s).`
  );

  if (
    result.summary.allowedCount === 0 &&
    result.summary.violationCount === 0 &&
    result.summary.invalidExceptionCount === 0
  ) {
    console.log("No unpinned action references found.");
    printRunFingerprint(fingerprint, runDetails);
    return;
  }

  printEnforcementSections(result);
  printRunFingerprint(fingerprint, runDetails);
}

function toScanOutput(
  result: ScanResult,
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  return {
    summary: result.summary,
    references: result.references,
    unpinned: result.unpinned,
    run: toRunOutput(fingerprint, runDetails)
  };
}

function toEnforcementOutput(
  result: EnforcementResult,
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  return {
    compliant: result.compliant,
    summary: result.summary,
    references: result.references,
    allowed: result.allowed,
    violations: result.violations,
    invalidExceptions: result.invalidExceptions,
    run: toRunOutput(fingerprint, runDetails)
  };
}

function printEnforcementSections(
  result: EnforcementResult,
  indent = "",
  options: {
    includeInvalidExceptions?: boolean;
  } = {}
) {
  if (result.allowed.length > 0) {
    console.log(`${indent}Allowed references:`);
    for (const entry of result.allowed) {
      console.log(`${indent}- ${formatEnforcementFinding(entry)}`);
    }
  }

  if (options.includeInvalidExceptions !== false && result.invalidExceptions.length > 0) {
    console.log(`${indent}Invalid or expired exceptions:`);
    for (const issue of result.invalidExceptions) {
      console.log(`${indent}- ${issue.message}`);
    }
  }

  if (result.violations.length > 0) {
    console.log(`${indent}Violations:`);
    for (const entry of result.violations) {
      console.log(`${indent}- ${formatEnforcementFinding(entry)}`);
    }
  }
}

function formatEnforcementFinding(entry: EnforcementResult["allowed"][number]): string {
  return `${toDisplayPath(entry.filePath)}:${entry.line} -> ${entry.raw} (${entry.message})`;
}

function countUpdatedReferences(patches: FilePatch[]): number {
  return patches.reduce((count, patch) => count + patch.referencesUpdated.length, 0);
}

function applyCommentFormatOverride(
  config: PinActionsConfig,
  commentFormat: string | undefined
): PinActionsConfig {
  if (commentFormat === undefined) {
    return config;
  }

  return {
    ...config,
    dependabot: {
      ...config.dependabot,
      commentFormat
    }
  };
}

function printDryRunPreview(
  patches: FilePatch[],
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails,
  formatEvidence: (patches: FilePatch[]) => string = () => "- (unavailable)"
) {
  if (patches.length === 0) {
    console.log("No changes would be made.");
    printRunFingerprint(fingerprint, runDetails);
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

  printEvidenceReport(patches, formatEvidence);
  printRunFingerprint(fingerprint, runDetails);
}

function printRunFingerprint(
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  const lines: Array<[string, string]> = [
    ["Tool version", formatToolVersionForDisplay(fingerprint.toolVersion)],
    ["Config hash", fingerprint.configHash],
    ["Fingerprint", fingerprint.fingerprint],
    ["Command", runDetails.command],
    ["Target", runDetails.target],
    ["Output", runDetails.output]
  ];

  if (runDetails.dryRun !== undefined) {
    lines.push(["Dry run", String(runDetails.dryRun)]);
  }
  if (runDetails.continueOnError !== undefined) {
    lines.push(["Continue on error", String(runDetails.continueOnError)]);
  }
  if (runDetails.failOnAmbiguous !== undefined) {
    lines.push(["Fail on ambiguous", String(runDetails.failOnAmbiguous)]);
  }
  if (runDetails.prCreate !== undefined) {
    lines.push(["Create PR", String(runDetails.prCreate)]);
  }

  console.log("\nRun fingerprint - reproducible proof-of-run (same inputs produce same hashes):");
  for (const [label, value] of lines) {
    console.log(`  ${(label + ":").padEnd(19)} ${value}`);
  }
}

function printEvidenceReport(
  patches: FilePatch[],
  formatEvidence: (patches: FilePatch[]) => string = () => "- (unavailable)"
) {
  console.log("\nEvidence:");
  console.log(formatEvidence(patches));
}

function toRunOutput(
  fingerprint: RunFingerprint,
  runDetails: RunExecutionDetails
) {
  return {
    ...fingerprint,
    execution: runDetails
  };
}

function formatToolVersionForDisplay(toolVersion: string): string {
  return toolVersion.startsWith("action-pinner@") ? toolVersion : `action-pinner@${toolVersion}`;
}
