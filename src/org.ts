import { createHash } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { matchesAnyPattern } from "./pattern-match.js";
import { normalizeGithubApiUrl } from "./resolver.js";

export type RepositoryOwnerType = "org" | "user";

export interface RepositoryMetadata {
  fullName: string;
  defaultBranch: string;
  archived: boolean;
}

export interface OrgScanOptions {
  org: string;
  includePrivate: boolean;
  includeArchived: boolean;
  githubApiUrl?: string;
}

export interface OwnerScanOptions {
  target: string;
  targetType: RepositoryOwnerType;
  includePrivate: boolean;
  includeArchived: boolean;
  githubApiUrl?: string;
}

interface RepositoryListItem {
  archived: boolean;
  default_branch: string;
  full_name: string;
  owner?: {
    login?: string;
  };
}

interface RepositoryEnumerationClient {
  paginate: <T>(route: unknown, params: Record<string, unknown>) => Promise<T[]>;
  repos: {
    listForOrg: unknown;
    listForUser: unknown;
    listForAuthenticatedUser: unknown;
  };
  users: {
    getAuthenticated: () => Promise<{ data: { login: string } }>;
  };
}

const repositoryEnumerationCache = new Map<string, RepositoryMetadata[]>();

export async function listOrgRepositories(
  options: OrgScanOptions,
  token?: string,
  client: RepositoryEnumerationClient = createRepositoryEnumerationClient(options.githubApiUrl, token)
): Promise<string[]> {
  const repositories = await listOwnerRepositories(
    {
      target: options.org,
      targetType: "org",
      includePrivate: options.includePrivate,
      includeArchived: options.includeArchived,
      githubApiUrl: options.githubApiUrl
    },
    token,
    client
  );

  return repositories.map((repository) => repository.fullName);
}

export async function listUserRepositories(
  options: Omit<OrgScanOptions, "org"> & { user: string },
  token?: string,
  client: RepositoryEnumerationClient = createRepositoryEnumerationClient(options.githubApiUrl, token)
): Promise<string[]> {
  const repositories = await listOwnerRepositories(
    {
      target: options.user,
      targetType: "user",
      includePrivate: options.includePrivate,
      includeArchived: options.includeArchived,
      githubApiUrl: options.githubApiUrl
    },
    token,
    client
  );

  return repositories.map((repository) => repository.fullName);
}

export async function listOwnerRepositories(
  options: OwnerScanOptions,
  token?: string,
  client: RepositoryEnumerationClient = createRepositoryEnumerationClient(options.githubApiUrl, token)
): Promise<RepositoryMetadata[]> {
  const cacheKey = [
    normalizeGithubApiUrl(options.githubApiUrl),
    options.targetType,
    options.target.toLowerCase(),
    options.includePrivate ? "private" : "public",
    options.includeArchived ? "archived" : "active",
    token
      ? `auth:${createHash("sha256").update(token).digest("hex").substring(0, 16)}`
      : "anonymous"
  ].join("|");
  const cached = repositoryEnumerationCache.get(cacheKey);
  if (cached) {
    return cached.map((repository) => ({ ...repository }));
  }

  const target = options.target.trim();
  const repositories =
    options.targetType === "user"
      ? await listUserRepositoriesFromClient(client, target, options.includePrivate, token)
      : await client.paginate<RepositoryListItem>(client.repos.listForOrg, {
          org: target,
          type: options.includePrivate ? "all" : "public",
          per_page: 100
        });

  const normalized = normalizeAndSortRepositoryMetadata(
    repositories
      .filter((repo) => options.includeArchived || !repo.archived)
      .map((repo) => ({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        archived: repo.archived
      }))
  );

  repositoryEnumerationCache.set(cacheKey, normalized);
  return normalized.map((repository) => ({ ...repository }));
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

export function filterRepositoryMetadata(
  repositories: RepositoryMetadata[],
  options: {
    includePatterns?: string[];
    excludePatterns?: string[];
  } = {}
): RepositoryMetadata[] {
  const includePatterns = options.includePatterns ?? [];
  const excludePatterns = options.excludePatterns ?? [];

  return normalizeAndSortRepositoryMetadata(repositories).filter((repository) => {
    if (
      includePatterns.length > 0 &&
      !matchesRepositoryPatterns(repository.fullName, includePatterns)
    ) {
      return false;
    }

    if (
      excludePatterns.length > 0 &&
      matchesRepositoryPatterns(repository.fullName, excludePatterns)
    ) {
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

function normalizeAndSortRepositoryMetadata(
  repositories: RepositoryMetadata[]
): RepositoryMetadata[] {
  const deduped = new Map<string, RepositoryMetadata>();
  for (const repository of repositories) {
    const normalized = normalizeRepository(repository.fullName);
    deduped.set(normalized.toLowerCase(), {
      ...repository,
      fullName: normalized
    });
  }

  return [...deduped.values()].sort((left, right) =>
    left.fullName.localeCompare(right.fullName, "en", { sensitivity: "base" })
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

async function listUserRepositoriesFromClient(
  client: RepositoryEnumerationClient,
  username: string,
  includePrivate: boolean,
  token?: string
): Promise<RepositoryListItem[]> {
  if (includePrivate && token) {
    const authenticated = await getAuthenticatedLogin(client);
    if (authenticated && authenticated.localeCompare(username, "en", { sensitivity: "accent" }) === 0) {
      return client
        .paginate<RepositoryListItem>(client.repos.listForAuthenticatedUser, {
          visibility: "all",
          affiliation: "owner",
          per_page: 100
        })
        .then((repositories) =>
          repositories.filter(
            (repository) =>
              repository.owner?.login?.localeCompare(username, "en", { sensitivity: "accent" }) === 0
          )
        );
    }
  }

  return client.paginate<RepositoryListItem>(client.repos.listForUser, {
    username,
    per_page: 100
  });
}

async function getAuthenticatedLogin(
  client: RepositoryEnumerationClient
): Promise<string | undefined> {
  try {
    const response = await client.users.getAuthenticated();
    return response.data.login;
  } catch {
    return undefined;
  }
}

function createRepositoryEnumerationClient(
  githubApiUrl?: string,
  token?: string
): RepositoryEnumerationClient {
  return new Octokit({
    auth: token,
    baseUrl: normalizeGithubApiUrl(githubApiUrl)
  }) as unknown as RepositoryEnumerationClient;
}
