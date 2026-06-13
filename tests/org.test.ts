import { describe, expect, it, vi } from "vitest";
import {
  filterRepositories,
  filterRepositoryMetadata,
  listOwnerRepositories
} from "../src/org.js";

describe("filterRepositories", () => {
  it("applies include patterns before exclude patterns with deterministic ordering", () => {
    const repositories = [
      "Acme/Platform-Core",
      "acme/platform-archive",
      "acme/service-b",
      "acme/service-a"
    ];

    const filtered = filterRepositories(repositories, {
      includePatterns: ["platform-*", "service-*"],
      excludePatterns: ["*-archive"]
    });

    expect(filtered).toEqual([
      "Acme/Platform-Core",
      "acme/service-a",
      "acme/service-b"
    ]);
  });

  it("supports repo-name only patterns", () => {
    const filtered = filterRepositories(
      ["acme/security-tools", "acme/platform", "other/acme-platform"],
      {
        includePatterns: ["platform", "security-*"]
      }
    );

    expect(filtered).toEqual(["acme/platform", "acme/security-tools"]);
  });
});

describe("filterRepositoryMetadata", () => {
  it("filters metadata with include-then-exclude ordering", () => {
    const filtered = filterRepositoryMetadata(
      [
        { fullName: "acme/service-b", defaultBranch: "main", archived: false },
        { fullName: "acme/platform-core", defaultBranch: "trunk", archived: false },
        { fullName: "acme/platform-archive", defaultBranch: "main", archived: true }
      ],
      {
        includePatterns: ["platform-*", "service-*"],
        excludePatterns: ["*-archive"]
      }
    );

    expect(filtered).toEqual([
      { fullName: "acme/platform-core", defaultBranch: "trunk", archived: false },
      { fullName: "acme/service-b", defaultBranch: "main", archived: false }
    ]);
  });
});

describe("listOwnerRepositories", () => {
  it("returns deterministic metadata for org scans", async () => {
    const client = {
      paginate: vi.fn().mockResolvedValue([
        { full_name: "acme/repo-b", default_branch: "develop", archived: false },
        { full_name: "acme/repo-a", default_branch: "main", archived: false }
      ]),
      repos: {
        listForOrg: {},
        listForUser: {},
        listForAuthenticatedUser: {}
      },
      users: {
        getAuthenticated: vi.fn()
      }
    };

    const repositories = await listOwnerRepositories(
      {
        target: "acme",
        targetType: "org",
        includePrivate: true,
        includeArchived: false
      },
      "token",
      client as any
    );

    expect(repositories).toEqual([
      { fullName: "acme/repo-a", defaultBranch: "main", archived: false },
      { fullName: "acme/repo-b", defaultBranch: "develop", archived: false }
    ]);
    expect(client.paginate).toHaveBeenCalledTimes(1);
  });

  it("uses authenticated-user enumeration for private user repo scans", async () => {
    const client = {
      paginate: vi.fn().mockResolvedValue([
        {
          full_name: "octocat/private-repo",
          default_branch: "main",
          archived: false,
          owner: { login: "octocat" }
        },
        {
          full_name: "other/ignored",
          default_branch: "main",
          archived: false,
          owner: { login: "other" }
        }
      ]),
      repos: {
        listForOrg: {},
        listForUser: {},
        listForAuthenticatedUser: {}
      },
      users: {
        getAuthenticated: vi.fn().mockResolvedValue({ data: { login: "octocat" } })
      }
    };

    const repositories = await listOwnerRepositories(
      {
        target: "octocat",
        targetType: "user",
        includePrivate: true,
        includeArchived: false
      },
      "token",
      client as any
    );

    expect(client.users.getAuthenticated).toHaveBeenCalledTimes(1);
    expect(client.paginate).toHaveBeenCalledWith(client.repos.listForAuthenticatedUser, {
      visibility: "all",
      affiliation: "owner",
      per_page: 100
    });
    expect(repositories).toEqual([
      { fullName: "octocat/private-repo", defaultBranch: "main", archived: false }
    ]);
  });
});
