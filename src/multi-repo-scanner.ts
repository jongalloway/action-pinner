import { Buffer } from "node:buffer";
import { Octokit } from "@octokit/rest";
import { matchesAnyPattern } from "./pattern-match.js";
import { buildScanResult, extractActionReferences } from "./scanner.js";
import { resolveWorkflowPatterns } from "./workflow-paths.js";
import type { ActionReference, ScanResult } from "./types.js";

export interface MultiRepoScanOptions {
  includePatterns: string[];
  excludePatterns: string[];
  includeActions: string[];
  excludeActions: string[];
  token?: string;
  githubApiUrl?: string;
}

export interface MultiRepoScanEntry {
  repository: string;
  defaultBranch: string;
  scan: ScanResult;
}

export interface MultiRepoScanResult {
  repositories: MultiRepoScanEntry[];
  summary: {
    repositoriesScanned: number;
    repositoriesWithUnpinned: number;
    filesScanned: number;
    referencesFound: number;
    unpinnedFound: number;
  };
}

interface RepoClient {
  repos: {
    get: (params: {
      owner: string;
      repo: string;
    }) => Promise<{ data: { default_branch: string } }>;
    getContent: (params: {
      owner: string;
      repo: string;
      path: string;
      ref: string;
    }) => Promise<{ data: { content: string; encoding: string } | unknown[] }>;
  };
  git: {
    getTree: (params: {
      owner: string;
      repo: string;
      tree_sha: string;
      recursive: "true";
    }) => Promise<{ data: { tree: Array<{ path?: string; type?: string }> } }>;
  };
}

export async function scanRepositories(
  repositories: string[],
  options: MultiRepoScanOptions,
  client: RepoClient = createRepoClient(options)
): Promise<MultiRepoScanResult> {
  const sortedRepositories = [...repositories].sort((left, right) =>
    left.localeCompare(right)
  );
  const entries: MultiRepoScanEntry[] = [];

  for (const repository of sortedRepositories) {
    const scan = await scanSingleRepository(repository, options, client);
    entries.push(scan);
  }

  return {
    repositories: entries,
    summary: {
      repositoriesScanned: entries.length,
      repositoriesWithUnpinned: entries.filter((entry) => entry.scan.unpinned.length > 0).length,
      filesScanned: entries.reduce((sum, entry) => sum + entry.scan.summary.filesScanned, 0),
      referencesFound: entries.reduce((sum, entry) => sum + entry.scan.summary.referencesFound, 0),
      unpinnedFound: entries.reduce((sum, entry) => sum + entry.scan.summary.unpinnedFound, 0)
    }
  };
}

async function scanSingleRepository(
  repository: string,
  options: MultiRepoScanOptions,
  client: RepoClient
): Promise<MultiRepoScanEntry> {
  const { owner, repo } = splitRepository(repository);
  const repoDetails = await client.repos.get({ owner, repo });
  const defaultBranch = repoDetails.data.default_branch;

  const tree = await client.git.getTree({
    owner,
    repo,
    tree_sha: defaultBranch,
    recursive: "true"
  });

  const includePatterns = resolveWorkflowPatterns(options.includePatterns);
  const workflowPaths = tree.data.tree
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path as string)
    .filter((path) => path.endsWith(".yml") || path.endsWith(".yaml"))
    .filter((path) => matchesAnyPattern(path, includePatterns, { caseInsensitive: true }))
    .filter(
      (path) =>
        !(options.excludePatterns.length > 0 &&
          matchesAnyPattern(path, options.excludePatterns, { caseInsensitive: true }))
    )
    .sort((left, right) => left.localeCompare(right));

  const references: ActionReference[] = [];
  for (const path of workflowPaths) {
    const contentResponse = await client.repos.getContent({
      owner,
      repo,
      path,
      ref: defaultBranch
    });
    if (Array.isArray(contentResponse.data)) {
      continue;
    }

    const content = decodeContent(contentResponse.data.content, contentResponse.data.encoding);
    const fileReferences = extractActionReferences(`${repository}/${path}`, content).filter(
      (reference) => {
        if (
          options.includeActions.length > 0 &&
          !matchesActionPattern(reference.action, options.includeActions)
        ) {
          return false;
        }

        if (
          options.excludeActions.length > 0 &&
          matchesActionPattern(reference.action, options.excludeActions)
        ) {
          return false;
        }

        return true;
      }
    );
    references.push(...fileReferences);
  }

  return {
    repository,
    defaultBranch,
    scan: buildScanResult(references, workflowPaths.length)
  };
}

function decodeContent(content: string, encoding: string): string {
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf8");
  }
  throw new Error(`Unsupported content encoding: ${encoding}`);
}

function createRepoClient(options: MultiRepoScanOptions): RepoClient {
  return new Octokit({
    auth: options.token,
    baseUrl: options.githubApiUrl
  }) as unknown as RepoClient;
}

function splitRepository(repository: string): { owner: string; repo: string } {
  const trimmed = repository.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error(
      `Invalid repository '${repository}'. Expected format is 'owner/repo'.`
    );
  }

  return { owner: parts[0], repo: parts[1] };
}

function matchesActionPattern(action: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.trim();
    if (!normalizedPattern) {
      return false;
    }

    const target = normalizedPattern.includes("/") ? action : action.split("/")[1] ?? action;
    return matchesAnyPattern(target, [normalizedPattern], { caseInsensitive: true });
  });
}
