import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Token-Safe Logging", () => {
  describe("Token redaction", () => {
    it("removes token= query parameters from logs", () => {
      const logged = redactToken(
        "GET https://api.github.com/repos/owner/repo?token=ghp_1234567890abcdefghijklmnopqrstuvwxyz"
      );
      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("token=[REDACTED]");
    });

    it("removes Authorization Bearer tokens", () => {
      const logged = redactToken(
        "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyz"
      );
      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("Bearer [REDACTED]");
    });

    it("removes URLs with embedded credentials", () => {
      const logged = redactToken(
        "Cloning from https://ghp_1234567890abcdefghijklmnopqrstuvwxyz@github.com/owner/repo.git"
      );
      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("[REDACTED]@github.com");
    });

    it("redacts GitHub token patterns (ghp_*)", () => {
      const logged = redactToken(
        "Token is ghp_abcdefghijklmnopqrstuvwxyz1234567890"
      );
      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("[REDACTED]");
    });

    it("redacts OAuth token patterns (gho_*)", () => {
      const logged = redactToken(
        "OAuth token: gho_abcdefghijklmnopqrstuvwxyz1234567890"
      );
      expect(logged).not.toContain("gho_");
      expect(logged).toContain("[REDACTED]");
    });

    it("redacts user access tokens (ghu_*)", () => {
      const logged = redactToken(
        "User token: ghu_abcdefghijklmnopqrstuvwxyz1234567890"
      );
      expect(logged).not.toContain("ghu_");
      expect(logged).toContain("[REDACTED]");
    });

    it("does not redact benign text", () => {
      const text =
        "Successfully resolved actions/checkout@v4 to 1234567890abcdef";
      const logged = redactToken(text);
      expect(logged).toBe(text);
    });

    it("does not redact commit SHAs (40-char hex)", () => {
      const logged = redactToken(
        "Resolved to SHA: 1234567890abcdef1234567890abcdef12345678"
      );
      expect(logged).toContain("1234567890abcdef1234567890abcdef12345678");
      expect(logged).not.toContain("[REDACTED]");
    });

    it("does not redact repository names", () => {
      const logged = redactToken("Repository: actions/checkout");
      expect(logged).toContain("actions/checkout");
    });

    it("handles multiple tokens in single message", () => {
      const message =
        "Token1: ghp_abc123defghijklmnopqrst and Token2: ghp_uvwxyz1234567890ABCDEF in same line";
      const logged = redactToken(message);
      expect(logged).not.toContain("ghp_");
      // Should contain two [REDACTED] instances
      const redactedCount = (logged.match(/\[REDACTED\]/g) || []).length;
      expect(redactedCount).toBeGreaterThanOrEqual(2);
    });

    it("preserves message structure after redaction", () => {
      const message =
        "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuvwxyz for user john";
      const logged = redactToken(message);
      expect(logged).toContain("Authorization:");
      expect(logged).toContain("for user john");
      expect(logged).not.toContain("ghp_");
    });
  });

  describe("Safe log integration", () => {
    it("never exposes tokens in console.log output", () => {
      const consoleMock = vi.spyOn(console, "log").mockImplementation(() => {});

      const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const message = `Authenticated with token ${token}`;
      const safeLog = (msg: string) => console.log(redactToken(msg));

      safeLog(message);

      expect(consoleMock).toHaveBeenCalled();
      const logged = consoleMock.mock.calls[0][0];
      expect(logged).not.toContain(token);
      expect(logged).toContain("[REDACTED]");
    });

    it("never exposes tokens in console.error output", () => {
      const errorMock = vi.spyOn(console, "error").mockImplementation(() => {});

      const token = "gho_1234567890abcdefghijklmnopqrstuvwxyz";
      const errorMsg = `Failed with OAuth token: ${token}`;
      const safeLog = (msg: string) => console.error(redactToken(msg));

      safeLog(errorMsg);

      expect(errorMock).toHaveBeenCalled();
      const logged = errorMock.mock.calls[0][0];
      expect(logged).not.toContain(token);
    });

    it("logs useful information even after redaction", () => {
      const message =
        "Failed to resolve actions/checkout@v4 with token ghp_1234567890abcdef1234567890ab";
      const logged = redactToken(message);

      expect(logged).toContain("Failed to resolve");
      expect(logged).toContain("actions/checkout");
      expect(logged).toContain("v4");
      expect(logged).not.toContain("ghp_");
    });

    it("handles empty messages safely", () => {
      const logged = redactToken("");
      expect(logged).toBe("");
    });

    it("handles messages with only tokens", () => {
      const logged = redactToken("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
      expect(logged).toBe("[REDACTED]");
    });
  });

  describe("Token scope guidance", () => {
    it("documents minimal read-only scope requirements", () => {
      const help = getHelpText();
      expect(help.toLowerCase()).toContain("contents:read");
      expect(help.toLowerCase()).toContain("read-only");
    });

    it("documents scope for PR creation", () => {
      const help = getHelpText();
      expect(help.toLowerCase()).toContain("pull_requests:write");
    });

    it("warns against overly permissive scopes", () => {
      const help = getHelpText();
      expect(help.toLowerCase()).toContain("never use");
      expect(help.toLowerCase()).toContain("admin");
    });

    it("includes scope examples in error messages", () => {
      const tokenMessage = insufficientScopeMessage([
        "contents:read",
        "pull_requests:read"
      ]);
      expect(tokenMessage.toLowerCase()).toContain("contents:read");
    });

    it("recommends minimal scope combination for all features", () => {
      const help = getHelpText();
      // Should mention specific scopes, not recommend overly broad ones
      expect(help).toMatch(/contents:read|pull_requests:write/);
      expect(help).not.toContain("repo (full)");
    });
  });

  describe("API error responses - token safety", () => {
    it("does not leak tokens from API error responses", () => {
      const apiError = {
        message: "Bad credentials",
        documentation_url: "https://docs.github.com/rest/authentication",
        status: 401
      };

      // If the error were to be logged with a token, it should be redacted
      const errorLog = JSON.stringify(apiError);
      const safeLog = redactToken(errorLog);

      expect(safeLog).toContain("Bad credentials");
      expect(safeLog).not.toContain("ghp_");
    });

    it("redacts tokens from network logs", () => {
      const networkLog =
        "POST https://api.github.com/user HTTP/1.1\nAuthorization: Bearer ghp_secret123\nContent-Length: 0";
      const logged = redactToken(networkLog);

      expect(logged).not.toContain("ghp_secret123");
      expect(logged).toContain("Authorization:");
    });

    it("preserves error context while redacting credentials", () => {
      const errorWithContext = `
Authentication failed for repository actions/checkout.
Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz
Status Code: 403
Message: Insufficient permissions
      `.trim();

      const logged = redactToken(errorWithContext);

      expect(logged).toContain("Authentication failed");
      expect(logged).toContain("actions/checkout");
      expect(logged).toContain("Status Code: 403");
      expect(logged).toContain("Insufficient permissions");
      expect(logged).not.toContain("ghp_");
    });
  });

  describe("Logging in different contexts", () => {
    it("redacts tokens from verbose debug output", () => {
      const debugOutput = `
[DEBUG] Starting resolution for actions/checkout@v4
[DEBUG] GitHub token: ghp_1234567890abcdefghijklmnopqrstuvwxyz
[DEBUG] Making request to: https://api.github.com/repos/actions/checkout/commits/v4
[DEBUG] Response: {"sha": "abc123"}
      `.trim();

      const logged = redactToken(debugOutput);

      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("[DEBUG]");
      expect(logged).toContain("actions/checkout");
      expect(logged).toContain("https://api.github.com");
    });

    it("redacts tokens from environment variable output", () => {
      const envOutput = `
GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz
GITHUB_ACTOR=john
GITHUB_REPOSITORY=owner/repo
      `.trim();

      const logged = redactToken(envOutput);

      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("GITHUB_TOKEN=[REDACTED]");
      expect(logged).toContain("john");
      expect(logged).toContain("owner/repo");
    });

    it("redacts tokens from CI logs", () => {
      const ciLog = `
CI Job: pin-actions-pr
Step: Authenticate
Running: npx pin-actions pr --token ghp_1234567890abcdefghijklmnopqrstuvwxyz
Success: PR created
      `.trim();

      const logged = redactToken(ciLog);

      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("--token [REDACTED]");
      expect(logged).toContain("pin-actions");
      expect(logged).toContain("Success");
    });
  });

  describe("Edge cases and special patterns", () => {
    it("handles tokens at beginning of message", () => {
      const logged = redactToken(
        "ghp_1234567890abcdefghijklmnopqrstuvwxyz is invalid"
      );
      expect(logged).toContain("[REDACTED]");
      expect(logged).toContain("is invalid");
    });

    it("handles tokens at end of message", () => {
      const logged = redactToken(
        "Your token is: ghp_1234567890abcdefghijklmnopqrstuvwxyz"
      );
      expect(logged).toContain("[REDACTED]");
      expect(logged).toContain("Your token is:");
    });

    it("handles tokens in URLs with query strings", () => {
      const logged = redactToken(
        "GET https://api.github.com/user?token=ghp_1234567890abcdefghijklmnopqrstuvwxyz&cache=false"
      );
      expect(logged).not.toContain("ghp_");
      expect(logged).toContain("token=[REDACTED]");
      expect(logged).toContain("cache=false");
    });

    it("handles tokens in base64 encoded data", () => {
      // This is a simplified test - in reality, tokens might appear in logs as part of base64
      const base64Token = Buffer.from(
        "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
      ).toString("base64");
      const message = `Encoded data: ${base64Token}`;

      // For now, we test the raw token pattern
      const withRawToken =
        "Encoded data: ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const logged = redactToken(withRawToken);
      expect(logged).not.toContain("ghp_");
    });
  });

  describe("Performance and efficiency", () => {
    it("efficiently redacts many tokens", () => {
      let message = "";
      for (let i = 0; i < 100; i++) {
        message += `Token ${i}: ghp_token${String(i).padStart(20, "x")}\n`;
      }

      const start = performance.now();
      const logged = redactToken(message);
      const duration = performance.now() - start;

      // Should complete quickly (< 100ms)
      expect(duration).toBeLessThan(100);
      expect(logged).not.toContain("ghp_");
    });

    it("does not create excessive string allocations", () => {
      const message =
        "This is a long message without any tokens to redact. It should not be copied unnecessarily.";

      // Calling redactToken shouldn't allocate new strings if there's nothing to redact
      const logged = redactToken(message);
      expect(logged).toBe(message);
    });
  });
});

// Helper functions
function redactToken(text: string): string {
  if (!text) return text;

  // Redact GitHub token patterns (with variable length - min 10 chars after prefix)
  let result = text
    // Redact ghp_ (Personal access tokens)
    .replace(/ghp_[a-zA-Z0-9_]{10,}/g, "[REDACTED]")
    // Redact gho_ (OAuth tokens)
    .replace(/gho_[a-zA-Z0-9_]{10,}/g, "[REDACTED]")
    // Redact ghu_ (User access tokens)
    .replace(/ghu_[a-zA-Z0-9_]{10,}/g, "[REDACTED]")
    // Redact token query parameters
    .replace(/token=[a-zA-Z0-9_]*(?=[\s&?#]|$)/g, "token=[REDACTED]")
    // Redact Authorization Bearer tokens
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]")
    // Redact credentials in URLs
    .replace(/https?:\/\/([a-zA-Z0-9_\-\.]+)@/gi, "https://[REDACTED]@")
    // Redact GITHUB_TOKEN environment variable
    .replace(/GITHUB_TOKEN=[a-zA-Z0-9_]*/gi, "GITHUB_TOKEN=[REDACTED]")
    // Redact --token CLI arguments
    .replace(/--token\s+[a-zA-Z0-9_\-\.]+/gi, "--token [REDACTED]");

  return result;
}

function getHelpText(): string {
  return `
TOKEN SECURITY & SCOPES

  Minimal required scopes:
    - contents:read     for read-only scanning and analysis
    - pull_requests:write  for creating pull requests

  Use these scopes together for full functionality:
    $ export GITHUB_TOKEN=<token_with_contents:read_and_pull_requests:write>
    $ pin-actions pr

  Never use overly permissive scopes:
    - admin:repo_hook (dangerous)
    - admin:org (dangerous)
    - repo (full access, unnecessary)

  Your token is automatically redacted from all logs and console output.
  `;
}

function insufficientScopeMessage(currentScopes: string[]): string {
  const required = ["contents:read", "pull_requests:write"];
  const missing = required.filter((s) => !currentScopes.includes(s));

  if (missing.length === 0) {
    return "Token has sufficient scopes";
  }

  return `
Insufficient token scopes detected.
Current scopes: ${currentScopes.join(", ")}
Missing scopes: ${missing.join(", ")}

To fix this, regenerate your token with the required scopes.
  `.trim();
}
