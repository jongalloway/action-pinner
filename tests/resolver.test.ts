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
