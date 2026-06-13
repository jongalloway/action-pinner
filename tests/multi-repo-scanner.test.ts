import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const octokitState = vi.hoisted(() => ({
  paginate: vi.fn(),
  listForOrg: vi.fn()
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    public paginate = octokitState.paginate;
    public repos = {
      listForOrg: octokitState.listForOrg
    };
  }
}));

import { scanRepositories } from "../src/multi-repo-scanner.js";
import { filterRepositories, listOrgRepositories } from "../src/org.js";

afterEach(() => {
  vi.restoreAllMocks();
  octokitState.paginate.mockReset();
  octokitState.listForOrg.mockReset();
});

describe("listOrgRepositories", () => {
  it("returns expected repositories in deterministic order", async () => {
    octokitState.paginate.mockResolvedValue([
      { full_name: "acme/service-b", archived: false },
      { full_name: "acme/service-a", archived: false },
      { full_name: "acme/archive-me", archived: true },
      { full_name: "acme/service-a", archived: false }
    ]);

    const repositories = await listOrgRepositories(
      {
        org: "acme",
        includePrivate: false,
        includeArchived: false
      },
      "test-token"
    );

    expect(repositories).toEqual(["acme/service-a", "acme/service-b"]);
    expect(octokitState.paginate).toHaveBeenCalledWith(octokitState.listForOrg, {
      org: "acme",
      type: "public",
      per_page: 100
    });
  });

  it("returns an empty list for an org with no repositories", async () => {
    octokitState.paginate.mockResolvedValue([]);

    await expect(
      listOrgRepositories(
        {
          org: "empty-org",
          includePrivate: true,
          includeArchived: false
        },
        "test-token"
      )
    ).resolves.toEqual([]);
  });
});

describe("filterRepositories", () => {
  it("applies include patterns", () => {
    const filtered = filterRepositories(
      ["acme/platform-core", "acme/service-a", "jon/personal-scripts"],
      {
        includePatterns: ["platform-*", "service-*"]
      }
    );

    expect(filtered).toEqual(["acme/platform-core", "acme/service-a"]);
  });

  it("applies excludes after includes so deny rules win", () => {
    const filtered = filterRepositories(
      ["acme/platform-core", "acme/platform-archive", "acme/service-a"],
      {
        includePatterns: ["platform-*", "service-*"],
        excludePatterns: ["*-archive"]
      }
    );

    expect(filtered).toEqual(["acme/platform-core", "acme/service-a"]);
  });

  it("returns every repository when include patterns are empty", () => {
    const filtered = filterRepositories(
      ["acme/service-b", "jon/tooling", "acme/service-a"],
      {
        includePatterns: []
      }
    );

    expect(filtered).toEqual(["acme/service-a", "acme/service-b", "jon/tooling"]);
  });

  it("returns no repositories when nothing matches the include patterns", () => {
    const filtered = filterRepositories(
      ["acme/service-a", "acme/service-b"],
      {
        includePatterns: ["platform-*"]
      }
    );

    expect(filtered).toEqual([]);
  });
});

describe("scanRepositories", () => {
  it("returns consolidated summary data while preserving per-repo results", async () => {
    const { client } = createRepoClient({
      "acme/repo-a": {
        defaultBranch: "main",
        workflows: {
          ".github/workflows/a.yml": workflowWithUses("actions/checkout@v4"),
          ".github/workflows/b.yml": workflowWithUses(
            "actions/setup-node@1234567890abcdef1234567890abcdef12345678"
          )
        }
      },
      "acme/repo-b": {
        defaultBranch: "develop",
        workflows: {
          ".github/workflows/ci.yml": workflowWithUses("evilcorp/build@main")
        }
      }
    });

    const result = await scanRepositories(
      ["acme/repo-b", "acme/repo-a"],
      {
        includePatterns: [],
        excludePatterns: [],
        includeActions: [],
        excludeActions: []
      },
      client
    );

    expect(result.repositories.map((entry) => entry.repository)).toEqual([
      "acme/repo-a",
      "acme/repo-b"
    ]);
    expect(result.repositories.map((entry) => entry.scan.summary.unpinnedFound)).toEqual([1, 1]);
    expect(result.summary).toEqual({
      repositoriesScanned: 2,
      repositoriesWithUnpinned: 2,
      filesScanned: 3,
      referencesFound: 3,
      unpinnedFound: 2
    });
    expect(result.consolidated.unpinned.map((entry) => entry.filePath)).toEqual([
      "acme/repo-a/.github/workflows/a.yml",
      "acme/repo-b/.github/workflows/ci.yml"
    ]);
  });

  it("filters workflow paths by include patterns and lets excludes win", async () => {
    const { client } = createRepoClient({
      "acme/repo-a": {
        workflows: {
          ".github/workflows/release.yml": workflowWithUses("actions/checkout@v4"),
          ".github/workflows/legacy/release.yml": workflowWithUses("actions/cache@v4"),
          ".github/workflows/ci.yml": workflowWithUses("actions/setup-node@v4")
        }
      }
    });

    const result = await scanRepositories(
      ["acme/repo-a"],
      {
        includePatterns: ["**/release.yml"],
        excludePatterns: ["**/legacy/**"],
        includeActions: [],
        excludeActions: []
      },
      client
    );

    expect(result.summary.filesScanned).toBe(1);
    expect(result.summary.referencesFound).toBe(1);
    expect(result.repositories[0].scan.unpinned.map((entry) => entry.filePath)).toEqual([
      "acme/repo-a/.github/workflows/release.yml"
    ]);
  });

  it("avoids duplicate API calls when the same repository is targeted more than once", async () => {
    const { client, reposGet, getTree, getContent } = createRepoClient({
      "acme/repo-a": {
        workflows: {
          ".github/workflows/ci.yml": workflowWithUses("actions/checkout@v4")
        }
      }
    });

    const result = await scanRepositories(
      ["acme/repo-a", "acme/repo-a"],
      {
        includePatterns: [],
        excludePatterns: [],
        includeActions: [],
        excludeActions: []
      },
      client
    );

    expect(result.repositories).toHaveLength(1);
    expect(reposGet).toHaveBeenCalledTimes(1);
    expect(getTree).toHaveBeenCalledTimes(1);
    expect(getContent).toHaveBeenCalledTimes(1);
  });

  it("reuses enumerated default branches to avoid repo metadata lookups", async () => {
    const { client, reposGet } = createRepoClient({
      "acme/repo-a": {
        defaultBranch: "trunk",
        workflows: {
          ".github/workflows/ci.yml": workflowWithUses("actions/checkout@v4")
        }
      }
    });

    const result = await scanRepositories(
      [{ repository: "acme/repo-a", defaultBranch: "trunk" }],
      {
        includePatterns: [],
        excludePatterns: [],
        includeActions: [],
        excludeActions: []
      },
      client
    );

    expect(result.repositories[0].defaultBranch).toBe("trunk");
    expect(reposGet).not.toHaveBeenCalled();
  });

  it("preserves single-repository compatibility", async () => {
    const { client } = createRepoClient({
      "jon/tooling": {
        defaultBranch: "main",
        workflows: {
          ".github/workflows/test.yaml": workflowWithUses("actions/setup-python@v5")
        }
      }
    });

    const result = await scanRepositories(
      ["jon/tooling"],
      {
        includePatterns: [],
        excludePatterns: [],
        includeActions: [],
        excludeActions: []
      },
      client
    );

    expect(result.summary.repositoriesScanned).toBe(1);
    expect(result.repositories[0]).toMatchObject({
      repository: "jon/tooling",
      defaultBranch: "main"
    });
    expect(result.repositories[0].scan.unpinned.map((entry) => entry.raw)).toEqual([
      "actions/setup-python@v5"
    ]);
  });

  it("propagates API failures instead of silently succeeding", async () => {
    const { client } = createRepoClient({
      "acme/repo-a": {
        workflows: {
          ".github/workflows/ci.yml": workflowWithUses("actions/checkout@v4")
        }
      }
    });

    client.repos.get = vi.fn().mockRejectedValue(new Error("GitHub API unavailable"));

    await expect(
      scanRepositories(
        ["acme/repo-a"],
        {
          includePatterns: [],
          excludePatterns: [],
          includeActions: [],
          excludeActions: []
        },
        client
      )
    ).rejects.toThrow("GitHub API unavailable");
  });
});

function workflowWithUses(reference: string): string {
  return ["jobs:", "  build:", "    steps:", `      - uses: ${reference}`].join("\n");
}

function createRepoClient(
  repositories: Record<
    string,
    {
      defaultBranch?: string;
      workflows: Record<string, string>;
    }
  >
) {
  const reposGet = vi.fn(async ({ owner, repo }: { owner: string; repo: string }) => {
    const repository = repositories[`${owner}/${repo}`];
    if (!repository) {
      throw new Error(`Unexpected repository ${owner}/${repo}`);
    }

    return {
      data: {
        default_branch: repository.defaultBranch ?? "main"
      }
    };
  });

  const getTree = vi.fn(async ({ owner, repo }: { owner: string; repo: string }) => {
    const repository = repositories[`${owner}/${repo}`];
    if (!repository) {
      throw new Error(`Unexpected repository ${owner}/${repo}`);
    }

    return {
      data: {
        tree: Object.keys(repository.workflows)
          .reverse()
          .map((path) => ({ path, type: "blob" as const }))
      }
    };
  });

  const getContent = vi.fn(
    async ({ owner, repo, path }: { owner: string; repo: string; path: string }) => {
      const repository = repositories[`${owner}/${repo}`];
      const content = repository?.workflows[path];
      if (!content) {
        throw new Error(`Unexpected workflow ${owner}/${repo}/${path}`);
      }

      return {
        data: {
          encoding: "base64",
          content: Buffer.from(content, "utf8").toString("base64")
        }
      };
    }
  );

  return {
    reposGet,
    getTree,
    getContent,
    client: {
      repos: {
        get: reposGet,
        getContent
      },
      git: {
        getTree
      }
    }
  };
}
