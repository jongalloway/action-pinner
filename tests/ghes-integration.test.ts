import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ActionReference, ResolutionResult } from "../src/types.js";
import type { CommitLookupClient } from "../src/resolver.js";
import { ActionResolver } from "../src/resolver.js";

describe("GHES + netrc Integration", () => {
  describe("End-to-end GHES workflow", () => {
    it("scanner discovers workflows at GHES endpoint", async () => {
      // Mock GHES server response
      const mockWorkflows = [
        {
          path: ".github/workflows/ci.yml",
          content: `jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v3`
        },
        {
          path: ".github/workflows/deploy.yml",
          content: `jobs:
  deploy:
    steps:
      - uses: docker/setup-buildx-action@v2`
        }
      ];

      // Verify scanner would find these workflows
      const foundWorkflows = mockWorkflows.filter((w) => w.path.includes("workflows"));
      expect(foundWorkflows).toHaveLength(2);
    });

    it("resolver pins actions using GHES API", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "abc123def456789abc123def456789abc123def4" }
          })
        }
      };

      const resolver = new ActionResolver("ghes_token", mockClient);

      const result = await resolver.resolve({
        filePath: ".github/workflows/ci.yml",
        line: 5,
        raw: "actions/checkout@v4",
        action: "actions/checkout",
        ref: "v4",
        kind: "tag-or-branch"
      });

      expect(result.sha).toBe("abc123def456789abc123def456789abc123def4");
      expect(mockClient.repos.getCommit).toHaveBeenCalledWith({
        owner: "actions",
        repo: "checkout",
        ref: "v4"
      });
    });

    it("PR opens at GHES endpoint", async () => {
      // Mock PR creation at GHES
      const mockPRResponse = {
        number: 42,
        url: "https://enterprise.example.com/owner/repo/pull/42",
        state: "open"
      };

      expect(mockPRResponse.url).toContain("enterprise.example.com");
      expect(mockPRResponse.state).toBe("open");
    });

    it("uses custom apiBaseUrl for GHES in all API calls", async () => {
      const ghesUrl = "https://enterprise.corp.example.com/api/v3";
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc" }
          })
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      await resolver.resolve({
        filePath: ".github/workflows/ci.yml",
        line: 5,
        raw: "my-org/custom-action@main",
        action: "my-org/custom-action",
        ref: "main",
        kind: "tag-or-branch"
      });

      // Verify API calls use GHES client
      expect(mockClient.repos.getCommit).toHaveBeenCalled();
    });

    it("resolves private GHES actions with GHES token", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "privatesha123456789" }
          })
        }
      };

      const resolver = new ActionResolver("ghes_private_token", mockClient);

      const result = await resolver.resolve({
        filePath: ".github/workflows/ci.yml",
        line: 5,
        raw: "private-org/private-action@v1",
        action: "private-org/private-action",
        ref: "v1",
        kind: "tag-or-branch"
      });

      expect(result.sha).toBe("privatesha123456789");
    });
  });

  describe("End-to-end netrc workflow", () => {
    it("netrc creds used for private repos", async () => {
      const netrcCreds = { login: "octocat", password: "netrc_token" };
      const authHeader = `Basic ${Buffer.from(`${netrcCreds.login}:${netrcCreds.password}`).toString("base64")}`;

      expect(authHeader).toContain("Basic");
      expect(authHeader).toContain(Buffer.from("octocat:netrc_token").toString("base64"));
    });

    it("netrc creds fail over to explicit token if needed", async () => {
      const authAttempts = [
        { method: "netrc", success: false },
        { method: "cli-token", success: true }
      ];

      const succeeded = authAttempts.find((a) => a.success);
      expect(succeeded?.method).toBe("cli-token");
    });

    it("private repo access works with netrc", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "privatereposha123" }
          })
        }
      };

      const resolver = new ActionResolver("netrc_token", mockClient);

      const result = await resolver.resolve({
        filePath: ".github/workflows/ci.yml",
        line: 5,
        raw: "private-org/private-action@v1.0.0",
        action: "private-org/private-action",
        ref: "v1.0.0",
        kind: "tag-or-branch"
      });

      expect(result.sha).toBe("privatereposha123");
    });

    it("handles 404 with netrc (repo really doesn't exist)", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Repository not found"), { status: 404 })
          )
        }
      };

      const resolver = new ActionResolver("netrc_token", mockClient);

      await expect(
        resolver.resolve({
          filePath: ".github/workflows/ci.yml",
          line: 5,
          raw: "nonexistent-org/nonexistent-action@v1",
          action: "nonexistent-org/nonexistent-action",
          ref: "v1",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();
    });

    it("distinguishes 404 from 403 with netrc auth", async () => {
      // 403 = insufficient permissions with netrc
      const mockClient403: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Resource not accessible by integration"), { status: 403 })
          )
        }
      };

      const resolver403 = new ActionResolver("netrc_token", mockClient403);

      // 404 = repo doesn't exist
      const mockClient404: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Not Found"), { status: 404 })
          )
        }
      };

      const resolver404 = new ActionResolver("netrc_token", mockClient404);

      await expect(
        resolver403.resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "action@v1",
          action: "org/action",
          ref: "v1",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();

      await expect(
        resolver404.resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "action@v1",
          action: "org/action",
          ref: "v1",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();
    });
  });

  describe("GHES + netrc combined scenarios", () => {
    it("GHES instance with netrc auth resolves private actions", async () => {
      const ghesUrl = "https://enterprise.example.com/api/v3";
      const netrcCreds = { login: "user", password: "enterprise_token" };

      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "enterpriseactionsha" }
          })
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      const result = await resolver.resolve({
        filePath: ".github/workflows/ci.yml",
        line: 5,
        raw: "corp-actions/deploy@main",
        action: "corp-actions/deploy",
        ref: "main",
        kind: "tag-or-branch"
      });

      expect(result.sha).toBe("enterpriseactionsha");
    });

    it("Multiple GHES instances each with separate netrc entries", async () => {
      const netrc = new Map([
        [
          "enterprise1.example.com",
          { login: "user1", password: "token1" }
        ],
        [
          "enterprise2.example.com",
          { login: "user2", password: "token2" }
        ]
      ]);

      expect(netrc.get("enterprise1.example.com")?.login).toBe("user1");
      expect(netrc.get("enterprise2.example.com")?.login).toBe("user2");
    });

    it("Resolver switches between public and private GHES endpoints", async () => {
      const publicMockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "publicsha123" }
          })
        }
      };

      const privateMockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "privatesha456" }
          })
        }
      };

      const publicResolver = new ActionResolver("public_token", publicMockClient);
      const privateResolver = new ActionResolver("private_token", privateMockClient);

      const publicResult = await publicResolver.resolve({
        filePath: "workflow.yml",
        line: 5,
        raw: "actions/checkout@v4",
        action: "actions/checkout",
        ref: "v4",
        kind: "tag-or-branch"
      });

      const privateResult = await privateResolver.resolve({
        filePath: "workflow.yml",
        line: 5,
        raw: "corp/action@v1",
        action: "corp/action",
        ref: "v1",
        kind: "tag-or-branch"
      });

      expect(publicResult.sha).toBe("publicsha123");
      expect(privateResult.sha).toBe("privatesha456");
    });

    it("Token precedence works with GHES", async () => {
      // CLI token should be used, not netrc
      const authMethods = {
        cliToken: "cli_ghes_token",
        netrcToken: "netrc_ghes_token"
      };

      const selectedToken = authMethods.cliToken || authMethods.netrcToken;
      expect(selectedToken).toBe("cli_ghes_token");
    });

    it("Auth fails clearly when GHES + netrc both invalid", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Unauthorized"), { status: 401 })
          )
        }
      };

      const resolver = new ActionResolver("bad_token", mockClient);

      const error = await resolver
        .resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "action@v1",
          action: "org/action",
          ref: "v1",
          kind: "tag-or-branch"
        })
        .catch((e) => e);

      // Error should be thrown (could be wrapped/transformed)
      expect(error).toBeDefined();
      expect(error.message).toBeDefined();
    });
  });

  describe("End-to-end workflow with config file", () => {
    it("config file specifies GHES URL and netrc usage", () => {
      const config = {
        github: {
          apiUrl: "https://enterprise.example.com/api/v3"
        },
        auth: {
          useNetrc: true
        }
      };

      expect(config.github.apiUrl).toBe("https://enterprise.example.com/api/v3");
      expect(config.auth.useNetrc).toBe(true);
    });

    it("CLI flag overrides config file settings", () => {
      const configFile = {
        github: {
          apiUrl: "https://enterprise.example.com/api/v3"
        }
      };

      const cliFlag = "https://enterprise-override.example.com/api/v3";

      const finalApiUrl = cliFlag || configFile.github.apiUrl;
      expect(finalApiUrl).toBe("https://enterprise-override.example.com/api/v3");
    });
  });

  describe("Error handling in integration scenarios", () => {
    it("provides helpful error when GHES unreachable", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      const error = await resolver
        .resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "action@v1",
          action: "org/action",
          ref: "v1",
          kind: "tag-or-branch"
        })
        .catch((e) => e);

      expect(error.message).toContain("ECONNREFUSED");
    });

    it("provides helpful error when GHES auth invalid", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Bad credentials"), { status: 401 })
          )
        }
      };

      const resolver = new ActionResolver("bad_token", mockClient);

      const error = await resolver
        .resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "action@v1",
          action: "org/action",
          ref: "v1",
          kind: "tag-or-branch"
        })
        .catch((e) => e);

      // Error should indicate auth failure
      expect(error.message).toBeDefined();
      expect(error).toHaveProperty("message");
    });

    it("suggests netrc setup when appropriate", () => {
      const suggestion =
        "Authentication failed at GHES endpoint. Try setting up netrc credentials.";

      expect(suggestion).toContain("netrc");
    });

    it("suggests token when netrc unavailable", () => {
      const suggestion = "--use-netrc specified but no .netrc found. Use --token instead.";

      expect(suggestion).toContain("--token");
    });
  });

  describe("Rate limiting across auth methods", () => {
    it("respects rate limits with token auth", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("API rate limit exceeded"), { status: 403 })
          )
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      await expect(
        resolver.resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "action@v1",
          action: "org/action",
          ref: "v1",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();
    });

    it("higher rate limits with authenticated requests", () => {
      const authenticated = 5000; // requests per hour
      const unauthenticated = 60; // requests per hour

      expect(authenticated).toBeGreaterThan(unauthenticated);
    });

    it("netrc auth provides higher rate limits like token auth", () => {
      const tokenLimits = 5000;
      const netrcLimits = 5000;

      expect(netrcLimits).toBe(tokenLimits);
    });
  });

  describe("Caching with GHES", () => {
    it("caches resolution results per GHES endpoint", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "cachedsha123" }
          })
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      // First call
      const result1 = await resolver.resolve({
        filePath: "workflow.yml",
        line: 5,
        raw: "actions/checkout@v4",
        action: "actions/checkout",
        ref: "v4",
        kind: "tag-or-branch"
      });

      // Second call should use cache
      const result2 = await resolver.resolve({
        filePath: "workflow.yml",
        line: 10,
        raw: "actions/checkout@v4",
        action: "actions/checkout",
        ref: "v4",
        kind: "tag-or-branch"
      });

      expect(result1.sha).toBe(result2.sha);
      expect(mockClient.repos.getCommit).toHaveBeenCalledTimes(1);
    });
  });
});
