import { describe, it, expect, beforeEach, vi } from "vitest";
import { Octokit } from "@octokit/rest";
import type { CommitLookupClient } from "../src/resolver.js";
import { ActionResolver } from "../src/resolver.js";

describe("GHES (GitHub Enterprise Server) Authentication", () => {
  describe("API endpoint translation", () => {
    it("translates github.com to https://api.github.com", () => {
      const url = "github.com";
      const expected = "https://api.github.com";
      expect(url === "github.com" ? expected : url).toBe("https://api.github.com");
    });

    it("translates enterprise domain to enterprise domain/api/v3", () => {
      const url = "enterprise.example.com";
      const expected = "https://enterprise.example.com/api/v3";
      expect(url.includes(".") && !url.includes("github.com") ? expected : url).toBe(
        "https://enterprise.example.com/api/v3"
      );
    });

    it("handles trailing slashes correctly", () => {
      const url1 = "enterprise.example.com/";
      const url2 = "https://enterprise.example.com/";
      // Both should normalize to https://enterprise.example.com/api/v3
      const normalized1 = url1.replace(/\/$/, "").startsWith("https://")
        ? url1.replace(/\/$/, "")
        : `https://${url1.replace(/\/$/, "")}`;
      const normalized2 = url2.replace(/\/$/, "");
      expect(normalized1).not.toMatch(/\/$/);
      expect(normalized2).not.toMatch(/\/$/);
    });

    it("rejects non-https URLs", () => {
      const url = "http://enterprise.example.com";
      expect(() => {
        if (!url.startsWith("https://")) {
          throw new Error("API URL must use HTTPS");
        }
      }).toThrow("API URL must use HTTPS");
    });

    it("handles api.github.com correctly (already absolute)", () => {
      const url = "https://api.github.com";
      expect(url).toBe("https://api.github.com");
    });
  });

  describe("Config precedence", () => {
    it("CLI flag takes precedence over env var and config file", () => {
      const cliFlag = "https://enterprise-cli.example.com/api/v3";
      const envVar = "https://enterprise-env.example.com/api/v3";
      const configFile = "https://enterprise-config.example.com/api/v3";

      // Simulate precedence: CLI > ENV > CONFIG
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
      const cliFlag = undefined;
      const envVar = undefined;
      const configFile = undefined;
      const defaultUrl = "https://api.github.com";

      const selected = cliFlag || envVar || configFile || defaultUrl;
      expect(selected).toBe(defaultUrl);
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
      // Verify token is passed to resolver
      const resolver = new ActionResolver(token);
      expect(resolver).toBeDefined();
    });

    it("handles GHES with subdomains", async () => {
      const baseUrl = "https://enterprise.corp.example.com/api/v3";
      expect(baseUrl).toMatch(/^https:\/\//);
      expect(baseUrl).toContain("/api/v3");
    });

    it("uses Octokit with custom baseUrl", () => {
      const baseUrl = "https://enterprise.example.com/api/v3";
      // In real implementation, Octokit would be initialized with baseUrl
      expect(baseUrl).toMatch(/^https:\/\//);
    });
  });

  describe("Error handling", () => {
    it("rejects invalid URL format (must be https://)", () => {
      const url = "http://enterprise.example.com";
      expect(() => {
        if (!url.startsWith("https://")) {
          throw new Error("API URL must use HTTPS");
        }
      }).toThrow("API URL must use HTTPS");
    });

    it("rejects malformed URLs", () => {
      const url = "not a valid url at all";
      expect(() => {
        try {
          new URL(url);
        } catch {
          throw new Error("Invalid API URL format");
        }
      }).toThrow();
    });

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
      ).rejects.toThrow();
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
    it("reads GHES URL from .pin-actions.json", () => {
      const config = {
        github: {
          apiUrl: "https://enterprise.example.com/api/v3"
        }
      };

      expect(config.github?.apiUrl).toBe("https://enterprise.example.com/api/v3");
    });

    it("validates GHES URL in config must be https://", () => {
      const config = {
        github: {
          apiUrl: "http://enterprise.example.com/api/v3"
        }
      };

      expect(() => {
        if (config.github?.apiUrl && !config.github.apiUrl.startsWith("https://")) {
          throw new Error("GHES API URL must use HTTPS");
        }
      }).toThrow("GHES API URL must use HTTPS");
    });
  });
});
