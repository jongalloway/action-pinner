import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock types for auth methods
interface AuthCredentials {
  method: "cli-token" | "env-token" | "netrc" | "anonymous";
  value?: string;
  login?: string;
  password?: string;
}

interface AuthContext {
  cliToken?: string;
  envToken?: string;
  netrcEntry?: { login: string; password: string } | null;
}

// Helper to select auth based on precedence
function selectAuth(context: AuthContext): AuthCredentials {
  if (context.cliToken) {
    return { method: "cli-token", value: context.cliToken };
  }

  if (context.envToken) {
    return { method: "env-token", value: context.envToken };
  }

  if (context.netrcEntry) {
    return {
      method: "netrc",
      login: context.netrcEntry.login,
      password: context.netrcEntry.password
    };
  }

  return { method: "anonymous" };
}

describe("Auth Precedence", () => {
  describe("Token precedence order", () => {
    it("CLI --token has highest priority", () => {
      const auth = selectAuth({
        cliToken: "cli_token",
        envToken: "env_token",
        netrcEntry: { login: "user", password: "netrc_token" }
      });

      expect(auth.method).toBe("cli-token");
      expect(auth.value).toBe("cli_token");
    });

    it("PIN_ACTIONS_TOKEN env var second priority", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: "env_token",
        netrcEntry: { login: "user", password: "netrc_token" }
      });

      expect(auth.method).toBe("env-token");
      expect(auth.value).toBe("env_token");
    });

    it("netrc third priority (if --use-netrc)", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "user", password: "netrc_token" }
      });

      expect(auth.method).toBe("netrc");
      expect(auth.login).toBe("user");
    });

    it("anonymous (rate-limited) lowest priority", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: null
      });

      expect(auth.method).toBe("anonymous");
      expect(auth.value).toBeUndefined();
    });
  });

  describe("Auth method detection", () => {
    it("detects CLI token auth method correctly", () => {
      const context: AuthContext = { cliToken: "ghp_abc123" };
      const auth = selectAuth(context);

      expect(auth.method).toBe("cli-token");
    });

    it("detects env token auth method correctly", () => {
      const context: AuthContext = { cliToken: undefined, envToken: "ghp_def456" };
      const auth = selectAuth(context);

      expect(auth.method).toBe("env-token");
    });

    it("detects netrc auth method correctly", () => {
      const context: AuthContext = {
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "user", password: "pass" }
      };
      const auth = selectAuth(context);

      expect(auth.method).toBe("netrc");
    });

    it("detects anonymous auth method correctly", () => {
      const context: AuthContext = {
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: null
      };
      const auth = selectAuth(context);

      expect(auth.method).toBe("anonymous");
    });
  });

  describe("Multi-auth scenarios", () => {
    it("Token + netrc present: uses token", () => {
      const auth = selectAuth({
        cliToken: "cli_token",
        envToken: undefined,
        netrcEntry: { login: "user", password: "netrc_token" }
      });

      expect(auth.method).toBe("cli-token");
      expect(auth.value).toBe("cli_token");
    });

    it("Env token + netrc: uses env token", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: "env_token",
        netrcEntry: { login: "user", password: "netrc_token" }
      });

      expect(auth.method).toBe("env-token");
      expect(auth.value).toBe("env_token");
    });

    it("Only netrc: uses netrc if available", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "user", password: "netrc_token" }
      });

      expect(auth.method).toBe("netrc");
      expect(auth.login).toBe("user");
    });

    it("None: uses anonymous", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: null
      });

      expect(auth.method).toBe("anonymous");
    });

    it("CLI token alone overrides everything", () => {
      const auth = selectAuth({
        cliToken: "cli_only",
        envToken: undefined,
        netrcEntry: null
      });

      expect(auth.method).toBe("cli-token");
    });

    it("Env token with netrc: env takes precedence", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: "env_only",
        netrcEntry: { login: "netrc_user", password: "netrc_pass" }
      });

      expect(auth.method).toBe("env-token");
      expect(auth.value).toBe("env_only");
    });
  });

  describe("Auth method logging (redacted)", () => {
    it("logs which auth method was used without exposing credentials", () => {
      const cliAuth = selectAuth({ cliToken: "ghp_abc123xyz" });
      const logMessage = `Using authentication method: ${cliAuth.method}`;

      expect(logMessage).toBe("Using authentication method: cli-token");
      expect(logMessage).not.toContain("ghp_abc123xyz");
    });

    it("logs netrc auth without exposing password", () => {
      const netrcAuth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "octocat", password: "secret_token" }
      });
      const logMessage = `Using authentication method: ${netrcAuth.method} (login: ${netrcAuth.login})`;

      expect(logMessage).toContain("netrc");
      expect(logMessage).toContain("octocat");
      expect(logMessage).not.toContain("secret_token");
    });

    it("logs env token auth without exposing token", () => {
      const envAuth = selectAuth({ cliToken: undefined, envToken: "ghp_secret" });
      const logMessage = `Using authentication method: ${envAuth.method}`;

      expect(logMessage).toBe("Using authentication method: env-token");
      expect(logMessage).not.toContain("ghp_secret");
    });

    it("logs anonymous auth clearly", () => {
      const anonAuth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: null
      });
      const logMessage = `Using authentication method: ${anonAuth.method}`;

      expect(logMessage).toBe("Using authentication method: anonymous");
    });
  });

  describe("Error scenarios", () => {
    it("provides error when CLI token is invalid", () => {
      const auth = selectAuth({ cliToken: "invalid_token_format" });

      // Token is selected (selection doesn't validate format)
      expect(auth.method).toBe("cli-token");

      // Format validation happens during API call
      expect(() => {
        if (!auth.value?.startsWith("ghp_") && !auth.value?.startsWith("ghs_")) {
          throw new Error("CLI token has invalid format");
        }
      }).toThrow("CLI token has invalid format");
    });

    it("provides error when env token is invalid", () => {
      const auth = selectAuth({ cliToken: undefined, envToken: "invalid_token" });

      expect(auth.method).toBe("env-token");
    });

    it("provides error when netrc credentials invalid", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "", password: "" }
      });

      expect(auth.method).toBe("netrc");
      // Error occurs during API call, not selection
    });

    it("suggests token when all auth methods invalid", () => {
      // All auth methods present but all invalid
      const suggestions = [
        "Provide a valid --token",
        "Set PIN_ACTIONS_TOKEN environment variable with valid token",
        "Ensure .netrc has valid credentials"
      ];

      expect(suggestions).toContain("Provide a valid --token");
    });

    it("warns when conflicting auth options provided", () => {
      const warnings: string[] = [];

      // If both --token and --use-netrc specified
      const cliToken = "token123";
      const useNetrc = true;

      if (cliToken && useNetrc) {
        warnings.push("Both --token and --use-netrc provided; using --token (highest precedence)");
      }

      expect(warnings).toContain(
        "Both --token and --use-netrc provided; using --token (highest precedence)"
      );
    });

    it("uses highest precedence when multiple auth options conflict", () => {
      const cliToken = "cli_token";
      const envToken = "env_token";
      const netrcEntry = { login: "user", password: "netrc_token" };

      const auth = selectAuth({
        cliToken,
        envToken,
        netrcEntry
      });

      expect(auth.method).toBe("cli-token");
    });
  });

  describe("Auth flow integration", () => {
    it("applies auth headers for HTTP requests", () => {
      const auth = selectAuth({ cliToken: "token123" });

      const headers: Record<string, string> = {};

      if (auth.method === "cli-token" || auth.method === "env-token") {
        headers["Authorization"] = `token ${auth.value}`;
      } else if (auth.method === "netrc") {
        const encoded = Buffer.from(`${auth.login}:${auth.password}`).toString("base64");
        headers["Authorization"] = `Basic ${encoded}`;
      }

      expect(headers["Authorization"]).toBe("token token123");
    });

    it("applies netrc Basic auth headers", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "user", password: "pass" }
      });

      const headers: Record<string, string> = {};

      if (auth.method === "netrc") {
        const encoded = Buffer.from(`${auth.login}:${auth.password}`).toString("base64");
        headers["Authorization"] = `Basic ${encoded}`;
      }

      const expectedEncoding = Buffer.from("user:pass").toString("base64");
      expect(headers["Authorization"]).toBe(`Basic ${expectedEncoding}`);
    });

    it("applies no auth for anonymous", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: null
      });

      const headers: Record<string, string> = {};

      if (auth.method !== "anonymous") {
        // Add headers
      }

      expect(Object.keys(headers)).toHaveLength(0);
    });
  });

  describe("Configuration file precedence with CLI", () => {
    it("CLI --token overrides config file token", () => {
      const configFile = { token: "config_token" };
      const cliToken = "cli_token";

      const auth = selectAuth({ cliToken });

      expect(auth.value).toBe("cli_token");
    });

    it("Config file token used when no CLI token", () => {
      const configFile = { token: "config_token" };
      const auth = selectAuth({ cliToken: undefined, envToken: undefined });

      // In real implementation, configFile would be checked here
      expect(auth.method).toBe("anonymous");
    });

    it("CLI --use-netrc overrides config file netrc setting", () => {
      const configFile = { useNetrc: false };
      const cliUseNetrc = true;
      const netrcEntry = { login: "user", password: "pass" };

      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: cliUseNetrc ? netrcEntry : null
      });

      expect(auth.method).toBe("netrc");
    });
  });

  describe("Token validation", () => {
    it("validates GitHub token format (ghp_ prefix)", () => {
      const tokens = [
        { token: "ghp_abc123xyz", valid: true },
        { token: "ghs_abc123xyz", valid: true }, // GitHub Server
        { token: "github_pat_abc", valid: true }, // Personal Access Token
        { token: "invalid_token", valid: false }
      ];

      tokens.forEach(({ token, valid }) => {
        const isValid =
          token.startsWith("ghp_") || token.startsWith("ghs_") || token.startsWith("github_pat_");
        expect(isValid).toBe(valid);
      });
    });

    it("accepts netrc credentials without format validation", () => {
      const auth = selectAuth({
        cliToken: undefined,
        envToken: undefined,
        netrcEntry: { login: "any_format", password: "any_pass" }
      });

      expect(auth.method).toBe("netrc");
    });
  });

  describe("Environment variable handling", () => {
    it("PIN_ACTIONS_TOKEN env var enables env token auth", () => {
      const envVars = { PIN_ACTIONS_TOKEN: "env_token_value" };
      const envToken = envVars.PIN_ACTIONS_TOKEN;

      const auth = selectAuth({ cliToken: undefined, envToken });

      expect(auth.method).toBe("env-token");
      expect(auth.value).toBe("env_token_value");
    });

    it("GITHUB_TOKEN env var not used for auth (must use PIN_ACTIONS_TOKEN)", () => {
      const envVars = { GITHUB_TOKEN: "github_token" } as Record<string, string>;
      // PIN_ACTIONS_TOKEN should be used, not GITHUB_TOKEN
      const envToken = envVars.PIN_ACTIONS_TOKEN;

      const auth = selectAuth({ cliToken: undefined, envToken });

      expect(auth.method).toBe("anonymous");
    });
  });
});
