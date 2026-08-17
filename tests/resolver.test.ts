import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionResolver } from "../src/resolver.js";
import type { ActionReference } from "../src/types.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ActionResolver", () => {
  it("retries transient rate limit errors", async () => {
    vi.useFakeTimers();

    const getCommit = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        response: { headers: { "retry-after": "1" } },
        message: "Too Many Requests"
      })
      .mockResolvedValueOnce({ data: { sha: "1234567890abcdef1234567890abcdef12345678" } });

    const resolver = new ActionResolver(undefined, {
      repos: { getCommit }
    });
    const reference = makeReference("actions/setup-node", "v4");

    const promise = resolver.resolve(reference);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toMatchObject({
      sha: "1234567890abcdef1234567890abcdef12345678"
    });
    expect(getCommit).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent lookups for the same ref", async () => {
    const getCommit = vi.fn().mockResolvedValue({
      data: { sha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }
    });

    const resolver = new ActionResolver(undefined, {
      repos: { getCommit }
    });
    const reference = makeReference("actions/checkout", "v4");

    const [first, second] = await Promise.all([
      resolver.resolve(reference),
      resolver.resolve(reference)
    ]);

    expect(first.sha).toBe("abcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(second.sha).toBe("abcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(getCommit).toHaveBeenCalledTimes(1);
  });

  it("selects the longest valid tag when an ambiguous ref has multiple tag matches", async () => {
    const getCommit = vi
      .fn()
      .mockRejectedValueOnce({
        status: 422,
        message: "Reference is ambiguous"
      })
      .mockResolvedValueOnce({ data: { sha: "2222222222222222222222222222222222222222" } });
    const listMatchingRefs = vi.fn().mockImplementation(({ ref }: { ref: string }) => {
      if (ref === "tags/v1") {
        return Promise.resolve({
          data: [
            makeRef("refs/tags/v1.0", "1111111111111111111111111111111111111111"),
            makeRef("refs/tags/v1.0.0", "2222222222222222222222222222222222222222"),
            makeRef("refs/tags/v10", "9999999999999999999999999999999999999999")
          ]
        });
      }

      return Promise.resolve({ data: [] });
    });

    const resolver = new ActionResolver(undefined, {
      repos: { getCommit },
      git: { listMatchingRefs }
    });

    await expect(resolver.resolve(makeReference("actions/setup-node", "v1"))).resolves.toMatchObject({
      sha: "2222222222222222222222222222222222222222",
      comment: "v1.0.0",
      resolutionMethod: "repos.getCommit (refs/tags/v1.0.0)"
    });
    expect(getCommit).toHaveBeenNthCalledWith(1, {
      owner: "actions",
      repo: "setup-node",
      ref: "v1"
    });
    expect(getCommit).toHaveBeenNthCalledWith(2, {
      owner: "actions",
      repo: "setup-node",
      ref: "tags/v1.0.0"
    });
  });

  it("fails closed when an ambiguous ref also has an exact branch with a different SHA", async () => {
    const getCommit = vi
      .fn()
      .mockRejectedValueOnce({
        status: 422,
        message: "Reference is ambiguous"
      });
    const listMatchingRefs = vi.fn().mockImplementation(({ ref }: { ref: string }) => {
      if (ref === "tags/v1") {
        return Promise.resolve({
          data: [makeRef("refs/tags/v1.0.0", "2222222222222222222222222222222222222222")]
        });
      }

      return Promise.resolve({
        data: [makeRef("refs/heads/v1", "3333333333333333333333333333333333333333")]
      });
    });

    const resolver = new ActionResolver(undefined, {
      repos: { getCommit },
      git: { listMatchingRefs }
    });

    await expect(resolver.resolve(makeReference("actions/setup-node", "v1"))).rejects.toMatchObject({
      name: "AmbiguousRefError",
      details: {
        matchingShas: [
          {
            sha: "2222222222222222222222222222222222222222",
            source: "refs/tags/v1.0.0 (tag object)"
          },
          { sha: "3333333333333333333333333333333333333333", source: "refs/heads/v1" }
        ]
      }
    });
    expect(getCommit).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an ambiguous ref also has an exact branch with the same SHA", async () => {
    const sha = "2222222222222222222222222222222222222222";
    const getCommit = vi
      .fn()
      .mockRejectedValueOnce({
        status: 422,
        message: "Reference is ambiguous"
      });
    const listMatchingRefs = vi.fn().mockImplementation(({ ref }: { ref: string }) => {
      if (ref === "tags/v1") {
        return Promise.resolve({
          data: [makeRef("refs/tags/v1.0.0", sha)]
        });
      }

      return Promise.resolve({
        data: [makeRef("refs/heads/v1", sha)]
      });
    });

    const resolver = new ActionResolver(undefined, {
      repos: { getCommit },
      git: { listMatchingRefs }
    });

    await expect(resolver.resolve(makeReference("actions/setup-node", "v1"))).rejects.toMatchObject({
      name: "AmbiguousRefError"
    });
    expect(getCommit).toHaveBeenCalledTimes(1);
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

function makeRef(ref: string, sha: string): { ref: string; object: { sha: string } } {
  return {
    ref,
    object: { sha }
  };
}
