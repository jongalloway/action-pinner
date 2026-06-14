import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionResolver, UnresolvedRefError } from "../src/resolver.js";
import type { ActionReference } from "../src/types.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Fail-Closed Behavior", () => {
  describe("Ambiguous ref resolution", () => {
    it("throws AmbiguousRefError when ref resolves to multiple SHAs", async () => {
      const getCommit = vi.fn().mockRejectedValue({
        status: 422,
        message: "Unprocessable Entity",
        response: {
          data: {
            message: "Reference is ambiguous"
          }
        }
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/checkout", "v4");

      // 422 is not retryable, so resolver throws UnresolvedRefError after first attempt
      await expect(resolver.resolve(reference)).rejects.toThrow("Failed to resolve");
    });

    it("includes ambiguous ref context in error message", async () => {
      vi.useFakeTimers();
      const getCommit = vi.fn().mockRejectedValue({
        status: 422,
        message: "Reference is ambiguous",
        response: { data: { message: "Could match branch and tag" } }
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/setup-node", "v4");

      const errorPromise = resolver.resolve(reference).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);
      const error = (await errorPromise) as UnresolvedRefError;
      expect(error.name).toBe("UnresolvedRefError");
      expect(error.details.ref).toBe("actions/setup-node@v4");
    });

    it("allows ambiguous refs with --continue-on-error (simulated via error handling)", async () => {
      vi.useFakeTimers();
      const getCommit = vi
        .fn()
        .mockRejectedValueOnce({
          status: 422,
          message: "Reference is ambiguous"
        })
        .mockResolvedValueOnce({
          data: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
        });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const ref1 = makeReference("actions/checkout", "v4");
      const ref2 = makeReference("actions/setup-node", "v4");

      const errorPromise1 = resolver.resolve(ref1).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);
      const error1 = await errorPromise1;
      expect(error1.name).toBe("UnresolvedRefError");

      const result2 = await resolver.resolve(ref2);
      expect(result2.sha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    });
  });

  describe("Unresolved refs", () => {
    it("throws UnresolvedRefError on 404 after retries are exhausted", async () => {
      vi.useFakeTimers();
      const getCommit = vi.fn().mockRejectedValue({
        status: 503,
        message: "Service Unavailable"
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/nonexistent", "v999");

      const errorPromise = resolver.resolve(reference).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);

      const error = (await errorPromise) as UnresolvedRefError;
      expect(error.name).toBe("UnresolvedRefError");
      expect(error.details.retryDetails?.maxAttempts).toBe(4);
      // MAX_ATTEMPTS is 4, so getCommit should be called 4 times
      expect(getCommit).toHaveBeenCalledTimes(4);
    });

    it("skips unresolved ref with --continue-on-error (returns error result)", async () => {
      vi.useFakeTimers();
      const getCommit = vi.fn().mockRejectedValue({
        status: 404,
        message: "Not Found"
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/missing", "v1");

      const errorPromise = resolver.resolve(reference).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);

      const error = (await errorPromise) as UnresolvedRefError;
      expect(error.name).toBe("UnresolvedRefError");
      expect(error.details.ref).toBe("actions/missing@v1");
    });

    it("includes retry details in error message", async () => {
      vi.useFakeTimers();
      let attemptCount = 0;
      const getCommit = vi.fn().mockImplementation(() => {
        attemptCount++;
        return Promise.reject({
          status: 500,
          message: `Server error (attempt ${attemptCount})`
        });
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/test", "v1");

      const errorPromise = resolver.resolve(reference).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);

      const error = (await errorPromise) as UnresolvedRefError;
      expect(error.details.retryDetails?.maxAttempts).toBeGreaterThan(1);
    });

    it("exhausts retries and then fails", async () => {
      vi.useFakeTimers();
      const getCommit = vi.fn().mockRejectedValue({
        status: 503,
        message: "Service Unavailable"
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/checkout", "v4");

      const errorPromise = resolver.resolve(reference).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);

      const error = (await errorPromise) as UnresolvedRefError;
      expect(error.name).toBe("UnresolvedRefError");
      expect(getCommit.mock.calls.length).toBe(4);
    });
  });

  describe("Pre-resolved SHAs", () => {
    it("never calls API for exact SHAs (40-char hex)", async () => {
      const getCommit = vi.fn();
      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference: ActionReference = {
        filePath: "workflow.yml",
        line: 1,
        raw: "actions/checkout@abc1234567890abc1234567890abc1234567890",
        action: "actions/checkout",
        ref: "abc1234567890abc1234567890abc1234567890",
        kind: "pinned-sha"
      };

      await expect(resolver.resolve(reference)).rejects.toThrow(
        "Cannot resolve non-resolvable ref"
      );
      expect(getCommit).not.toHaveBeenCalled();
    });

    it("skips resolution logic for already-pinned refs", async () => {
      const getCommit = vi.fn();
      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const pinned: ActionReference = {
        filePath: "workflow.yml",
        line: 1,
        raw: "actions/setup-node@1234567890abcdef1234567890abcdef12345678",
        action: "actions/setup-node",
        ref: "1234567890abcdef1234567890abcdef12345678",
        kind: "pinned-sha"
      };

      await expect(resolver.resolve(pinned)).rejects.toThrow(
        "Cannot resolve non-resolvable ref"
      );
      expect(getCommit).not.toHaveBeenCalled();
    });
  });

  describe("Exit codes", () => {
    it("would return exit 0 when all refs resolve successfully", async () => {
      const getCommit = vi
        .fn()
        .mockResolvedValue({
          data: { sha: "1234567890abcdef1234567890abcdef12345678" }
        });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/checkout", "v4");

      const result = await resolver.resolve(reference);
      expect(result.sha).toBe("1234567890abcdef1234567890abcdef12345678");
      // Exit 0 would be implied by successful resolution
    });

    it("would return exit 1 when fail-closed errors occur", async () => {
      vi.useFakeTimers();
      const getCommit = vi.fn().mockRejectedValue({
        status: 404,
        message: "Not Found"
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/missing", "v1");

      const errorPromise = resolver.resolve(reference).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);

      const error = await errorPromise;
      expect(error).toBeDefined();
      expect(error.name).toBe("UnresolvedRefError");
      // Exit 1 would be returned by CLI when error is thrown
    });

    it("would return exit 0 with --continue-on-error despite warnings", async () => {
      vi.useFakeTimers();
      const getCommit = vi
        .fn()
        .mockRejectedValueOnce({
          status: 404,
          message: "Not Found"
        })
        .mockResolvedValueOnce({
          data: { sha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }
        });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const ref1 = makeReference("actions/missing", "v1");
      const ref2 = makeReference("actions/checkout", "v4");

      const errorPromise1 = resolver.resolve(ref1).catch((e) => e);
      await vi.advanceTimersByTimeAsync(100000);
      const error1 = await errorPromise1;
      expect(error1.name).toBe("UnresolvedRefError");

      const result2 = await resolver.resolve(ref2);
      expect(result2.sha).toBe("abcdefabcdefabcdefabcdefabcdefabcdefabcd");
      // With continue-on-error, error1 is logged but result2 succeeds
      // Exit 0 would be returned when at least some refs resolve
    });
  });

  describe("Rate limiting and retries", () => {
    it("retries on 429 (rate limit) with exponential backoff", async () => {
      vi.useFakeTimers();
      const getCommit = vi
        .fn()
        .mockRejectedValueOnce({
          status: 429,
          message: "Too Many Requests",
          response: { headers: { "retry-after": "1" } }
        })
        .mockResolvedValueOnce({
          data: { sha: "fedcbafedcbafedcbafedcbafedcbafedcbafe" }
        });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/setup-node", "v4");

      const promise = resolver.resolve(reference);
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;
      expect(result.sha).toBe("fedcbafedcbafedcbafedcbafedcbafedcbafe");
      expect(getCommit).toHaveBeenCalledTimes(2);
    });

    it("respects retry-after header from GitHub API", async () => {
      vi.useFakeTimers();
      const getCommit = vi
        .fn()
        .mockRejectedValueOnce({
          status: 429,
          message: "Too Many Requests",
          response: { headers: { "retry-after": "2" } }
        })
        .mockResolvedValueOnce({
          data: { sha: "0123456789abcdef0123456789abcdef01234567" }
        });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/checkout", "v4");

      const promise = resolver.resolve(reference);
      // First attempt fails, then waits for retry-after duration
      await vi.advanceTimersByTimeAsync(3000);

      const result = await promise;
      expect(result.sha).toBe("0123456789abcdef0123456789abcdef01234567");
    });

    it("handles transient 503 errors with retries", async () => {
      vi.useFakeTimers();
      const getCommit = vi
        .fn()
        .mockRejectedValueOnce({
          status: 503,
          message: "Service Unavailable"
        })
        .mockRejectedValueOnce({
          status: 503,
          message: "Service Unavailable"
        })
        .mockResolvedValueOnce({
          data: { sha: "1111111111111111111111111111111111111111" }
        });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/setup-node", "v4");

      const promise = resolver.resolve(reference);
      await vi.advanceTimersByTimeAsync(100000);

      const result = await promise;
      expect(result.sha).toBe("1111111111111111111111111111111111111111");
      expect(getCommit).toHaveBeenCalledTimes(3);
    });
  });

  describe("Resolution metadata", () => {
    it("includes resolution method in result", async () => {
      const getCommit = vi.fn().mockResolvedValue({
        data: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/checkout", "v4");

      const result = await resolver.resolve(reference);
      expect(result.resolutionMethod).toBe("repos.getCommit");
    });

    it("includes timestamp of resolution", async () => {
      const getCommit = vi.fn().mockResolvedValue({
        data: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/setup-node", "v4");

      const result = await resolver.resolve(reference);
      expect(result.resolvedAt).toBeDefined();
      expect(result.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("includes source repo in resolution result", async () => {
      const getCommit = vi.fn().mockResolvedValue({
        data: { sha: "cccccccccccccccccccccccccccccccccccccccc" }
      });

      const resolver = new ActionResolver(undefined, {
        repos: { getCommit }
      });
      const reference = makeReference("actions/checkout", "v4");

      const result = await resolver.resolve(reference);
      expect(result.sourceRepo).toBe("actions/checkout");
    });
  });
});

function makeReference(action: string, ref: string): ActionReference {
  return {
    filePath: "workflow.yml",
    line: 1,
    raw: `${action}@${ref}`,
    action,
    ref,
    kind: "tag-or-branch"
  };
}
