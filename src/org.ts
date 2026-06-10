import { Octokit } from "@octokit/rest";
import { matchesAnyPattern } from "./pattern-match.js";

export interface OrgScanOptions {
  org: string;
  includePrivate: boolean;
  includeArchived: boolean;
}

export async function listOrgRepositories(
  options: OrgScanOptions,
  token?: string
): Promise<string[]> {
  const octokit = new Octokit({ auth: token });
  const repositories = await octokit.paginate(octokit.repos.listForOrg, {
    org: options.org,
    type: options.includePrivate ? "all" : "public",
    per_page: 100
  });

  const fullNames = repositories
    .filter((repo) => options.includeArchived || !repo.archived)
    .map((repo) => repo.full_name);
  return normalizeAndSortRepositories(fullNames);
}

export function filterRepositories(
  repositories: string[],
  options: {
    includePatterns?: string[];
    excludePatterns?: string[];
  } = {}
): string[] {
  const normalized = normalizeAndSortRepositories(repositories);
  const includePatterns = options.includePatterns ?? [];
  const excludePatterns = options.excludePatterns ?? [];

  return normalized.filter((repository) => {
    if (includePatterns.length > 0 && !matchesRepositoryPatterns(repository, includePatterns)) {
      return false;
    }

    // Exclusion is applied last so deny rules always win deterministically.
    if (excludePatterns.length > 0 && matchesRepositoryPatterns(repository, excludePatterns)) {
      return false;
    }

    return true;
  });
}

export function normalizeAndSortRepositories(repositories: string[]): string[] {
  const deduped = new Map<string, string>();
  for (const repository of repositories) {
    const normalized = normalizeRepository(repository);
    deduped.set(normalized.toLowerCase(), normalized);
  }

  return [...deduped.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" })
  );
}

function normalizeRepository(repository: string): string {
  const normalized = repository.trim();
  const parts = normalized.split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error(
      `Invalid repository '${repository}'. Expected format is 'owner/repo'.`
    );
  }

  return `${parts[0]}/${parts[1]}`;
}

function matchesRepositoryPatterns(repository: string, patterns: string[]): boolean {
  const [, repoName] = repository.split("/");

  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed.includes("/")) {
      return matchesAnyPattern(repository, [trimmed], { caseInsensitive: true });
    }

    return matchesAnyPattern(repoName, [trimmed], { caseInsensitive: true });
  });
}
