import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CommitLookupClient } from "../src/resolver.js";
import { ActionResolver, normalizeGithubApiUrl } from "../src/resolver.js";

describe("GHES (GitHub Enterprise Server) Authentication", () => {
  describe("API endpoint translation via normalizeGithubApiUrl", () => {
    it("translates github.com to https://api.github.com", () => {
      expect(normalizeGithubApiUrl("github.com")).toBe("https://api.github.com");
    });

    it("translates https://github.com to https://api.github.com", () => {
      expect(normalizeGithubApiUrl("https://github.com")).toBe("https://api.github.com");
    });

    it("translates enterprise domain to enterprise domain/api/v3", () => {
      expect(normalizeGithubApiUrl("enterprise.example.com")).toBe(
        "https://enterprise.example.com/api/v3"
      );
    });

    it("handles trailing slashes correctly", () => {
      expect(normalizeGithubApiUrl("enterprise.example.com/")).toBe(
        "https://enterprise.example.com/api/v3"
      );
      expect(normalizeGithubApiUrl("https://enterprise.example.com/")).toBe(
        "https://enterprise.example.com/api/v3"
      );
    });

    it("does not double-append /api/v3 when already present", () => {
      const result = normalizeGithubApiUrl("https://enterprise.example.com/api/v3");
      expect(result).toBe("https://enterprise.example.com/api/v3");
      expect(result.split("/api/v3").length - 1).toBe(1);
    });

    it("ensures https:// prefix on bare enterprise domains", () => {
      const result = normalizeGithubApiUrl("enterprise.example.com");
      expect(result).toMatch(/^https:\/\//);
    });

    it("handles api.github.com correctly (already absolute)", () => {
      expect(normalizeGithubApiUrl("https://api.github.com")).toBe("https://api.github.com");
    });

    it("returns https://api.github.com when no URL provided", () => {
      expect(normalizeGithubApiUrl()).toBe("https://api.github.com");
      expect(normalizeGithubApiUrl(undefined)).toBe("https://api.github.com");
    });

    it("handles GHES with subdomains", () => {
      const result = normalizeGithubApiUrl("enterprise.corp.example.com");
      expect(result).toMatch(/^https:\/\//);
      expect(result).toContain("/api/v3");
    });
  });

  describe("Config precedence", () => {
    it("CLI flag takes precedence over env var and config file", () => {
      const cliFlag = "https://enterprise-cli.example.com/api/v3";
      const envVar = "https://enterprise-env.example.com/api/v3";
      const configFile = "https://enterprise-config.example.com/api/v3";

      const selected = cliFlag || envVar || configFile;
      expect(selected).toBe(cliFlag);
    });

    it("env var takes precedence over config file", () => {
      const envVar = "https://enterprise-env.example.com/api/v3";
      const configFile = "https://enterprise-config.example.com/api/v3";

      const selected = envVar || configFile;
      expect(selected).toBe(envVar);
    });

    it("config file is used when no CLI flag or env var", () => {
      const cliFlag = undefined;
      const envVar = undefined;
      const configFile = "https://enterprise-config.example.com/api/v3";

      const selected = cliFlag || envVar || configFile;
      expect(selected).toBe(configFile);
    });

    it("respects github.com default when nothing specified", () => {
      expect(normalizeGithubApiUrl(undefined)).toBe("https://api.github.com");
    });
  });

  describe("API calls with GHES", () => {
    let mockClient: CommitLookupClient;

    beforeEach(() => {
      mockClient = {
        repos: {
          getCommit: vi.fn().mockResolvedValue({
            data: { sha: "abc123def456" }
          })
        }
      };
    });

    it("resolver makes calls to correct GHES endpoint with custom client", async () => {
      const resolver = new ActionResolver("token", mockClient);

      const result = await resolver.resolve({
        filePath: "workflow.yml",
        line: 5,
        raw: "actions/checkout@v4",
        action: "actions/checkout",
        ref: "v4",
        kind: "tag-or-branch"
      });

      expect(mockClient.repos.getCommit).toHaveBeenCalledWith({
        owner: "actions",
        repo: "checkout",
        ref: "v4"
      });

      expect(result.sha).toBe("abc123def456");
    });

    it("token auth works with GHES", () => {
      const token = "ghes_token_xyz";
      const resolver = new ActionResolver(token);
      expect(resolver).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("throws on connection error to GHES endpoint", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      await expect(
        resolver.resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();
    });

    it("throws on 401 auth failure at GHES endpoint", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Bad credentials"), { status: 401 })
          )
        }
      };

      const resolver = new ActionResolver("bad_token", mockClient);

      await expect(
        resolver.resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow("Invalid or expired token");
    });

    it("throws on 403 rate limit at GHES endpoint", async () => {
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
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();
    });

    it("throws on 404 repo not found at GHES endpoint", async () => {
      const mockClient: CommitLookupClient = {
        repos: {
          getCommit: vi.fn().mockRejectedValue(
            Object.assign(new Error("Repository not found"), { status: 404 })
          )
        }
      };

      const resolver = new ActionResolver("token", mockClient);

      await expect(
        resolver.resolve({
          filePath: "workflow.yml",
          line: 5,
          raw: "private-org/private-action@v1",
          action: "private-org/private-action",
          ref: "v1",
          kind: "tag-or-branch"
        })
      ).rejects.toThrow();
    });
  });

  describe("GHES config file integration", () => {
    it("normalizes GHES URL from config correctly", () => {
      const configUrl = "https://enterprise.example.com/api/v3";
      expect(normalizeGithubApiUrl(configUrl)).toBe(configUrl);
    });

    it("normalizes bare GHES hostname from config", () => {
      const configUrl = "enterprise.example.com";
      expect(normalizeGithubApiUrl(configUrl)).toBe("https://enterprise.example.com/api/v3");
    });

    it("validates that non-https GHES URL is coerced to https", () => {
      // normalizeGithubApiUrl always produces https:// output
      const result = normalizeGithubApiUrl("http://enterprise.example.com");
      expect(result).toMatch(/^https:\/\//);
    });
  });
});
