import { Octokit } from "@octokit/rest";
import { simpleGit, type SimpleGit } from "simple-git";
import type { FilePatch, PinActionsConfig } from "./types.js";
import { toDisplayPath } from "./workflow-paths.js";
import { buildRunFingerprint, formatEvidence, collectEvidence } from "./report.js";
import { formatEvidenceMarkdownTable } from "./table-formatter.js";
import { getToolVersion } from "./version.js";

export interface CreatePrOptions {
  config: PinActionsConfig;
  patches: FilePatch[];
  branchName?: string;
  git?: Pick<SimpleGit, "branch" | "checkoutLocalBranch" | "add" | "commit">;
}

export interface PublishPrOptions {
  config: PinActionsConfig;
  patches: FilePatch[];
  branch: string;
  baseBranch: string;
  commitMessage?: string;
  token?: string;
  git?: Pick<SimpleGit, "raw" | "getRemotes">;
  client?: GitHubPrClient;
  repository?: GitHubRepository;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export interface GitHubPrClient {
  pulls: {
    create: (args: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      head: string;
      base: string;
    }) => Promise<{ data: { number: number; html_url: string } }>;
    requestReviewers: (args: {
      owner: string;
      repo: string;
      pull_number: number;
      reviewers: string[];
    }) => Promise<unknown>;
  };
  issues: {
    addLabels: (args: {
      owner: string;
      repo: string;
      issue_number: number;
      labels: string[];
    }) => Promise<unknown>;
    addAssignees: (args: {
      owner: string;
      repo: string;
      issue_number: number;
      assignees: string[];
    }) => Promise<unknown>;
  };
}

export interface CreatedPrResult {
  number: number;
  htmlUrl: string;
}

export async function createPullRequestBranch({
  config,
  patches,
  branchName,
  git = simpleGit()
}: CreatePrOptions): Promise<{ branch: string; baseBranch: string; commitMessage: string }> {
  const branchInfo = await git.branch();
  const baseBranch = branchInfo.current;
  const branch = branchName ?? `${config.pr.branchPrefix}-${Date.now()}`;
  const commitMessage = "chore: pin GitHub Actions to commit SHAs";

  await git.checkoutLocalBranch(branch);
  await git.add(patches.map((patch) => patch.filePath));
  await git.commit(commitMessage);

  return { branch, baseBranch, commitMessage };
}

export async function publishPullRequest({
  config,
  patches,
  branch,
  baseBranch,
  commitMessage = "chore: pin GitHub Actions to commit SHAs",
  token,
  git = simpleGit(),
  client,
  repository
}: PublishPrOptions): Promise<CreatedPrResult | null> {
  if (!config.pr.create) {
    return null;
  }

  if (!token) {
    throw new Error(
      "A GitHub token is required to create pull requests. " +
      "Set PIN_ACTIONS_TOKEN or use --token, or ensure GITHUB_TOKEN is available."
    );
  }

  const repo = repository ?? (await resolveRepositoryInfo(git));
  const octokit = client ?? createPullRequestClient(token);
  const toolVersion = await getToolVersion();
  const runFingerprint = buildRunFingerprint(config, toolVersion);
  const body = buildPrBody(patches, config.pr.bodyTemplate, {
    branch,
    baseBranch,
    commitMessage,
    evidence: formatEvidenceMarkdownTable(collectEvidence(patches)),
    toolVersion: runFingerprint.toolVersion,
    configHash: runFingerprint.configHash,
    runFingerprint: runFingerprint.fingerprint
  });

  await git.raw(["push", "-u", "origin", branch]);

  const pullRequest = await octokit.pulls.create({
    owner: repo.owner,
    repo: repo.repo,
    title: config.pr.title,
    body,
    head: branch,
    base: baseBranch
  });

  const issueNumber = pullRequest.data.number;
  if (config.pr.labels.length > 0) {
    await octokit.issues.addLabels({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issueNumber,
      labels: config.pr.labels
    });
  }

  if (config.pr.assignees.length > 0) {
    await octokit.issues.addAssignees({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issueNumber,
      assignees: config.pr.assignees
    });
  }

  if (config.pr.reviewers.length > 0) {
    await octokit.pulls.requestReviewers({
      owner: repo.owner,
      repo: repo.repo,
      pull_number: issueNumber,
      reviewers: config.pr.reviewers
    });
  }

  return {
    number: issueNumber,
    htmlUrl: pullRequest.data.html_url
  };
}

export function buildPrBody(
  patches: FilePatch[],
  template = DEFAULT_PR_BODY_TEMPLATE,
  contextOverrides: Partial<PrTemplateContext> = {}
): string {
  const context = buildPrTemplateContext(patches, contextOverrides);
  return renderTemplate(template, context).trim();
}

export async function resolveRepositoryInfo(
  git: Pick<SimpleGit, "getRemotes">
): Promise<GitHubRepository> {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((remote) => remote.name === "origin");
  const remoteUrl = origin?.refs.fetch ?? origin?.refs.push;

  if (!remoteUrl) {
    throw new Error("Unable to determine the origin remote URL.");
  }

  return parseRepositoryUrl(remoteUrl);
}

function buildPrTemplateContext(
  patches: FilePatch[],
  contextOverrides: Partial<PrTemplateContext>
): PrTemplateContext {
  const files = patches.map((patch) => `- ${toDisplayPath(patch.filePath)}`).join("\n");
  const references = patches
    .flatMap((patch) =>
      patch.referencesUpdated.map(
        (reference) => `- ${toDisplayPath(reference.filePath)}:${reference.line} ${reference.raw}`
      )
    )
    .join("\n");

  const context: PrTemplateContext = {
    summary: `Pinned ${countUpdatedReferences(patches)} action reference(s) across ${patches.length} file(s).`,
    fileCount: patches.length,
    referenceCount: countUpdatedReferences(patches),
    files: files || "- (none)",
    references: references || "- (none)",
    evidence: formatEvidenceMarkdownTable(collectEvidence(patches)),
    branch: "",
    baseBranch: "",
    commitMessage: "",
    toolVersion: "",
    configHash: "",
    runFingerprint: "",
    ...contextOverrides
  };

  return context;
}

function renderTemplate(template: string, context: PrTemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = context[key as keyof PrTemplateContext];
    return value === undefined ? match : String(value);
  });
}

function countUpdatedReferences(patches: FilePatch[]): number {
  return patches.reduce((count, patch) => count + patch.referencesUpdated.length, 0);
}

function createPullRequestClient(token: string): GitHubPrClient {
  return new Octokit({ auth: token }) as unknown as GitHubPrClient;
}

function parseRepositoryUrl(remoteUrl: string): GitHubRepository {
  const sshMatch = remoteUrl.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const sshUrlMatch = remoteUrl.match(/^ssh:\/\/git@[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshUrlMatch) {
    return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new Error(`Unsupported origin remote URL: ${remoteUrl}`);
}

interface PrTemplateContext {
  summary: string;
  fileCount: number;
  referenceCount: number;
  files: string;
  references: string;
  evidence: string;
  branch: string;
  baseBranch: string;
  commitMessage: string;
  toolVersion: string;
  configHash: string;
  runFingerprint: string;
}

const DEFAULT_PR_BODY_TEMPLATE = [
  "## Summary",
  "",
  "{{summary}}",
  "",
  "## Updated workflows",
  "",
  "{{files}}",
  "",
  "## Updated references",
  "",
  "{{references}}",
  "",
  "## Evidence",
  "",
  "{{evidence}}",
  "",
  "## Run fingerprint",
  "",
  "- Tool version: `{{toolVersion}}`",
  "- Config hash: `{{configHash}}`",
  "- Run fingerprint: `{{runFingerprint}}`",
  "",
  "## Branch",
  "",
  "- `{{branch}}`"
].join("\n");
