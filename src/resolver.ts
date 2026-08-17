import { Octokit } from "@octokit/rest";
import type { ActionReference, ResolutionResult } from "./types.js";
import { AmbiguousRefError, UnresolvedRefError } from "./types.js";
import { getNetrcCredentials, redactNetrcAuth } from "./netrc-auth.js";

export interface CommitLookupClient {
  repos: {
    getCommit: (args: {
      owner: string;
      repo: string;
      ref: string;
    }) => Promise<{ data: { sha: string } }>;
  };
  git?: {
    listMatchingRefs: (args: {
      owner: string;
      repo: string;
      ref: string;
    }) => Promise<{
      data: Array<{
        ref: string;
        object: {
          sha: string;
        };
      }>;
    }>;
  };
}

export interface ResolverOptions {
  token?: string;
  apiBaseUrl?: string;
  useNetrc?: boolean;
  verbose?: boolean;
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const RESOLUTION_METHOD = "repos.getCommit";

export function normalizeGithubApiUrl(url?: string): string {
  if (!url) {
    return "https://api.github.com";
  }

  let normalized = url.trim().toLowerCase();

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, "");

  // Handle github.com special case
  if (normalized === "https://github.com" || normalized === "github.com") {
    return "https://api.github.com";
  }

  // If it's an enterprise URL without /api/v3, add it
  // Extract the hostname to check precisely (avoid substring false matches like evil.api.github.com)
  const hostname = normalized.replace(/^https?:\/\//, "").split("/")[0];
  if (!normalized.includes("/api/v3") && hostname !== "api.github.com") {
    normalized = `${normalized}/api/v3`;
  }

  // Ensure https://
  if (!normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }

  return normalized;
}

export function buildResolutionKey(reference: Pick<ActionReference, "action" | "ref">): string {
  return `${reference.action}@${reference.ref}`;
}

export class ActionResolver {
  private octokit: CommitLookupClient;
  private readonly cache = new Map<string, ResolutionResult>();
  private readonly inFlight = new Map<string, Promise<ResolutionResult>>();
  private readonly verbose: boolean;
  private authMethod: string;
  private readonly initPromise: Promise<void>;

  public constructor(token?: string, client?: CommitLookupClient, options?: ResolverOptions) {
    this.verbose = options?.verbose ?? false;
    this.authMethod = "anonymous";

    if (client) {
      this.octokit = client;
      this.initPromise = Promise.resolve();
    } else {
      const apiBaseUrl = normalizeGithubApiUrl(options?.apiBaseUrl);

      if (token) {
        this.octokit = new Octokit({ auth: token, baseUrl: apiBaseUrl }) as CommitLookupClient;
        this.authMethod = "token";
        this.initPromise = Promise.resolve();
      } else if (options?.useNetrc) {
        this.authMethod = "netrc";
        // Placeholder until init resolves; initNetrcAuth will replace this with an authenticated client
        this.octokit = new Octokit({ baseUrl: apiBaseUrl }) as CommitLookupClient;
        this.initPromise = this.initNetrcAuth(apiBaseUrl);
      } else {
        this.octokit = new Octokit({ baseUrl: apiBaseUrl }) as CommitLookupClient;
        this.authMethod = "anonymous (rate-limited)";
        this.initPromise = Promise.resolve();
      }
    }

    if (this.verbose) {
      console.log(`GitHub API base URL: ${this.getBaseUrl()}`);
      console.log(`Authentication method: ${this.authMethod}`);
    }
  }

  private async initNetrcAuth(apiBaseUrl: string): Promise<void> {
    const host = new URL(apiBaseUrl).hostname;
    const creds = await getNetrcCredentials(host);
    if (creds) {
      this.octokit = new Octokit({
        auth: `${creds.login}:${creds.password}`,
        baseUrl: apiBaseUrl
      }) as CommitLookupClient;
    } else {
      this.authMethod = "anonymous (rate-limited)";
    }
  }

  private getBaseUrl(): string {
    const octokit = this.octokit as unknown as { request?: { endpoint?: { baseUrl?: string } } };
    return octokit.request?.endpoint?.baseUrl ?? "https://api.github.com";
  }

  public async resolve(reference: ActionReference): Promise<ResolutionResult> {
    await this.initPromise;
    if (!reference.ref) {
      throw new Error(`Cannot resolve missing ref for ${reference.raw}`);
    }
    if (reference.kind !== "tag-or-branch" || SHA_PATTERN.test(reference.ref)) {
      throw new Error(`Cannot resolve non-resolvable ref for ${reference.raw}`);
    }

    const cacheKey = buildResolutionKey(reference);
    const existing = this.cache.get(cacheKey);
    if (existing) {
      return existing;
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const [owner, repo] = reference.action.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid action slug: ${reference.action}`);
    }

    const lookup = this.lookupCommit(owner, repo, reference.ref, cacheKey);
    this.inFlight.set(cacheKey, lookup);

    return lookup.finally(() => {
      this.inFlight.delete(cacheKey);
    });
  }

  private async lookupCommit(
    owner: string,
    repo: string,
    ref: string,
    cacheKey: string
  ): Promise<ResolutionResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const commit = await this.octokit.repos.getCommit({
          owner,
          repo,
          ref
        });

        const result: ResolutionResult = {
          original: `${owner}/${repo}@${ref}`,
          sha: commit.data.sha,
          comment: ref,
          sourceRepo: `${owner}/${repo}`,
          resolutionMethod: RESOLUTION_METHOD,
          resolvedAt: new Date().toISOString(),
          githubApiUrl: this.getBaseUrl()
        };
        this.cache.set(cacheKey, result);
        return result;
      } catch (error) {
        lastError = error;
        const status = this.getStatus(error);

        if (status === 422 && this.isAmbiguousRef(error)) {
          const result = await this.resolveAmbiguousRef(owner, repo, ref, cacheKey);
          if (result) {
            return result;
          }
        }

        // Handle authentication errors
        if (status === 401) {
          const message =
            this.authMethod === "netrc"
              ? "Authentication failed with netrc credentials. Check machine entry in ~/.netrc"
              : "Invalid or expired token. Check PIN_ACTIONS_TOKEN or CLI --token";
          throw new Error(message);
        }

        if (attempt >= MAX_ATTEMPTS - 1 || !this.isRetryable(error)) {
          break;
        }

        await this.delay(this.getDelayMs(error, attempt));
      }
    }

    throw new UnresolvedRefError(
      `${owner}/${repo}@${ref}`,
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      lastError instanceof Error ? lastError.message : String(lastError)
    );
  }

  private async resolveAmbiguousRef(
    owner: string,
    repo: string,
    ref: string,
    cacheKey: string
  ): Promise<ResolutionResult | undefined> {
    if (!this.octokit.git?.listMatchingRefs) {
      return undefined;
    }

    const [tagMatches, branchMatches] = await Promise.all([
      this.octokit.git.listMatchingRefs({
        owner,
        repo,
        ref: `tags/${ref}`
      }),
      this.octokit.git.listMatchingRefs({
        owner,
        repo,
        ref: `heads/${ref}`
      })
    ]);

    const preferredTag = selectPreferredTag(ref, tagMatches.data);
    if (!preferredTag) {
      return undefined;
    }

    const exactBranch = branchMatches.data.find((match) => match.ref === `refs/heads/${ref}`);
    if (exactBranch) {
      throw new AmbiguousRefError(`${owner}/${repo}@${ref}`, [
        { sha: preferredTag.sha, source: `${preferredTag.ref} (tag object)` },
        { sha: exactBranch.object.sha, source: exactBranch.ref }
      ]);
    }

    const commit = await this.octokit.repos.getCommit({
      owner,
      repo,
      ref: `tags/${preferredTag.name}`
    });

    const result: ResolutionResult = {
      original: `${owner}/${repo}@${ref}`,
      sha: commit.data.sha,
      comment: preferredTag.name,
      sourceRepo: `${owner}/${repo}`,
      resolutionMethod: `${RESOLUTION_METHOD} (${preferredTag.ref})`,
      resolvedAt: new Date().toISOString(),
      githubApiUrl: this.getBaseUrl()
    };
    this.cache.set(cacheKey, result);
    return result;
  }

  private isRetryable(error: unknown): boolean {
    const status = this.getStatus(error);
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }

    if (status === 403 && this.isSecondaryRateLimit(error)) {
      return true;
    }

    if (typeof status === "number" && status >= 500 && status <= 599) {
      return true;
    }

    const code = this.getCode(error);
    return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN";
  }

  private getDelayMs(error: unknown, attempt: number): number {
    const retryAfter = this.getHeader(error, "retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_DELAY_MS);
      }
    }

    const reset = this.getHeader(error, "x-ratelimit-reset");
    if (reset) {
      const resetAt = Number(reset) * 1000;
      if (Number.isFinite(resetAt) && resetAt > Date.now()) {
        return Math.min(resetAt - Date.now() + 250, MAX_DELAY_MS);
      }
    }

    return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }

  private getCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  private getHeader(error: unknown, name: string): string | undefined {
    if (!error || typeof error !== "object") {
      return undefined;
    }

    const headers = (error as { response?: { headers?: Record<string, unknown> } }).response
      ?.headers;
    const value = headers?.[name.toLowerCase()];
    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
      return value[0];
    }

    return undefined;
  }

  private isSecondaryRateLimit(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return /secondary rate limit/i.test(error.message);
  }

  private isAmbiguousRef(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && /ambiguous/i.test(message)) {
      return true;
    }

    const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data
      ?.message;
    return typeof responseMessage === "string" && /ambiguous/i.test(responseMessage);
  }
}

export { AmbiguousRefError, UnresolvedRefError } from "./types.js";
export { applyNetrcAuth, redactNetrcAuth } from "./netrc-auth.js";

function selectPreferredTag(
  requestedRef: string,
  matches: Array<{ ref: string; object: { sha: string } }>
): { name: string; ref: string; sha: string } | undefined {
  const prefix = "refs/tags/";
  const validTags = matches
    .map((match) => {
      if (!match.ref.startsWith(prefix)) {
        return undefined;
      }

      const name = match.ref.slice(prefix.length);
      if (!isValidTagCandidate(requestedRef, name)) {
        return undefined;
      }

      return {
        name,
        ref: match.ref,
        sha: match.object.sha
      };
    })
    .filter((tag): tag is { name: string; ref: string; sha: string } => Boolean(tag));

  return validTags.sort((left, right) => {
    const lengthComparison = right.name.length - left.name.length;
    return lengthComparison === 0 ? left.name.localeCompare(right.name) : lengthComparison;
  })[0];
}

function isValidTagCandidate(requestedRef: string, tagName: string): boolean {
  return (
    requestedRef.length > 0 &&
    (tagName === requestedRef ||
      tagName.startsWith(`${requestedRef}.`) ||
      tagName.startsWith(`${requestedRef}-`) ||
      tagName.startsWith(`${requestedRef}_`))
  );
}
