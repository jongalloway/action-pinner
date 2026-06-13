import { Octokit } from "@octokit/rest";
import type { ActionReference, ResolutionResult } from "./types.js";
import { AmbiguousRefError, UnresolvedRefError } from "./types.js";
<<<<<<< HEAD
import { getNetrcCredentials, encodeNetrcAuth, applyNetrcAuth, redactNetrcAuth } from "./netrc-auth.js";
=======
import { getNetrcCredentials, redactNetrcAuth } from "./netrc-auth.js";
>>>>>>> origin/main

export interface CommitLookupClient {
  repos: {
    getCommit: (args: {
      owner: string;
      repo: string;
      ref: string;
    }) => Promise<{ data: { sha: string } }>;
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
<<<<<<< HEAD
  private netrcInit: Promise<void> | null = null;
=======
  private readonly initPromise: Promise<void>;
>>>>>>> origin/main

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
<<<<<<< HEAD
        this.octokit = new Octokit(octokitOptions) as CommitLookupClient;
      } else if (options?.useNetrc) {
        // Create an initial unauthenticated client; netrc credentials will be
        // loaded asynchronously and the client replaced before the first request.
        this.octokit = new Octokit(octokitOptions) as CommitLookupClient;
        this.authMethod = "netrc (pending)";
        this.netrcInit = this.initNetrcAuth(apiBaseUrl);
=======
        this.initPromise = Promise.resolve();
      } else if (options?.useNetrc) {
        this.authMethod = "netrc";
        // Placeholder until init resolves; initNetrcAuth will replace this with an authenticated client
        this.octokit = new Octokit({ baseUrl: apiBaseUrl }) as CommitLookupClient;
        this.initPromise = this.initNetrcAuth(apiBaseUrl);
>>>>>>> origin/main
      } else {
        this.octokit = new Octokit({ baseUrl: apiBaseUrl }) as CommitLookupClient;
        this.authMethod = "anonymous (rate-limited)";
<<<<<<< HEAD
        this.octokit = new Octokit(octokitOptions) as CommitLookupClient;
=======
        this.initPromise = Promise.resolve();
>>>>>>> origin/main
      }
    }

    if (this.verbose) {
      console.log(`GitHub API base URL: ${this.getBaseUrl()}`);
      console.log(`Authentication method: ${this.authMethod}`);
    }
  }

  private async initNetrcAuth(apiBaseUrl: string): Promise<void> {
<<<<<<< HEAD
    try {
      const host = new URL(apiBaseUrl).hostname;
      const creds = await getNetrcCredentials(host);
      if (creds) {
        const auth = `Basic ${encodeNetrcAuth(creds.login, creds.password)}`;
        this.octokit = new Octokit({ baseUrl: apiBaseUrl, auth }) as CommitLookupClient;
        this.authMethod = "netrc";
      } else {
        this.authMethod = "anonymous (rate-limited)";
      }
    } catch {
=======
    const host = new URL(apiBaseUrl).hostname;
    const creds = await getNetrcCredentials(host);
    if (creds) {
      this.octokit = new Octokit({
        auth: `${creds.login}:${creds.password}`,
        baseUrl: apiBaseUrl
      }) as CommitLookupClient;
    } else {
>>>>>>> origin/main
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

    if (this.netrcInit) {
      await this.netrcInit;
      this.netrcInit = null;
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
          resolvedAt: new Date().toISOString()
        };
        this.cache.set(cacheKey, result);
        return result;
      } catch (error) {
        lastError = error;
        const status = this.getStatus(error);

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
}

export { AmbiguousRefError, UnresolvedRefError } from "./types.js";
export { applyNetrcAuth, redactNetrcAuth } from "./netrc-auth.js";

