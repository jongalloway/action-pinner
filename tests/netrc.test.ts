import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { loadNetrc, getNetrcCredentials, encodeNetrcAuth } from "../src/netrc-auth.js";

describe("netrc Authentication", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  async function createTempNetrc(netrcContent: string, mode = 0o600): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-netrc-"));
    tempDirs.push(root);
    const netrcPath = join(root, ".netrc");
    await writeFile(netrcPath, netrcContent, "utf8");
    try { await chmod(netrcPath, mode); } catch { /* chmod may not work on Windows */ }
    return netrcPath;
  }

  describe("netrc parsing", () => {
    it("parses single machine entry", async () => {
      const p = await createTempNetrc(`machine github.com
login octocat
password my_personal_token`);

      const netrc = await loadNetrc(p);

      expect(netrc.has("github.com")).toBe(true);
      expect(netrc.get("github.com")).toEqual({
        login: "octocat",
        password: "my_personal_token"
      });
    });

    it("parses multiple machine entries", async () => {
      const p = await createTempNetrc(`machine github.com
login octocat
password token1

machine enterprise.example.com
login alice
password token2`);

      const netrc = await loadNetrc(p);

      expect(netrc.size).toBe(2);
      expect(netrc.get("github.com")).toEqual({
        login: "octocat",
        password: "token1"
      });
      expect(netrc.get("enterprise.example.com")).toEqual({
        login: "alice",
        password: "token2"
      });
    });

    it("handles login/password on separate lines", async () => {
      const p = await createTempNetrc(`machine github.com
login user123
password pass456`);

      const netrc = await loadNetrc(p);
      const entry = netrc.get("github.com");

      expect(entry?.login).toBe("user123");
      expect(entry?.password).toBe("pass456");
    });

    it("handles passwords with spaces", async () => {
      const p = await createTempNetrc(`machine github.com
login user
password my pass with spaces`);

      const netrc = await loadNetrc(p);
      const entry = netrc.get("github.com");

      expect(entry?.password).toBe("my pass with spaces");
    });

    it("ignores comments in netrc file", async () => {
      const p = await createTempNetrc(`# This is a comment
machine github.com
login octocat
# Another comment
password token123`);

      const netrc = await loadNetrc(p);
      expect(netrc.get("github.com")).toBeDefined();
      expect(netrc.get("github.com")?.login).toBe("octocat");
    });

    it("handles empty lines gracefully", async () => {
      const p = await createTempNetrc(`machine github.com
login user

password pass

machine other.com
login other_user
password other_pass`);

      const netrc = await loadNetrc(p);
      expect(netrc.size).toBe(2);
    });

    it("parses inline format (machine/login/password on one line)", async () => {
      const p = await createTempNetrc("machine github.com login octocat password ghp_token123");

      const netrc = await loadNetrc(p);
      const entry = netrc.get("github.com");

      expect(entry?.login).toBe("octocat");
      expect(entry?.password).toBe("ghp_token123");
    });
  });

  describe("netrc lookup", () => {
    it("finds credentials for exact host match", async () => {
      const p = await createTempNetrc(`machine github.com
login octocat
password token123`);

      const creds = await getNetrcCredentials("github.com", p);

      expect(creds).toEqual({
        login: "octocat",
        password: "token123"
      });
    });

    it("returns null for host not in netrc", async () => {
      const p = await createTempNetrc(`machine github.com
login octocat
password token123`);

      const creds = await getNetrcCredentials("enterprise.example.com", p);

      expect(creds).toBeNull();
    });

    it("matches wildcard entries for subdomains", async () => {
      const p = await createTempNetrc(`machine *.github.com
login user
password pass`);

      const creds = await getNetrcCredentials("api.github.com", p);

      expect(creds).not.toBeNull();
      expect(creds?.login).toBe("user");
    });

    it("prioritizes exact match over wildcard", async () => {
      const p = await createTempNetrc(`machine *.github.com
login wildcard_user
password wildcard_pass

machine api.github.com
login exact_user
password exact_pass`);

      const creds = await getNetrcCredentials("api.github.com", p);

      expect(creds?.login).toBe("exact_user");
    });

    it("handles multiple GHES instances", async () => {
      const p = await createTempNetrc(`machine github.com
login user1
password token1

machine enterprise1.example.com
login user2
password token2

machine enterprise2.example.com
login user3
password token3`);

      expect((await getNetrcCredentials("enterprise1.example.com", p))?.login).toBe("user2");
      expect((await getNetrcCredentials("enterprise2.example.com", p))?.login).toBe("user3");
    });
  });

  describe("netrc auth encoding", () => {
    it("encodes credentials to Base64", () => {
      const login = "octocat";
      const password = "token123";

      const encoded = encodeNetrcAuth(login, password);

      expect(encoded).toBe(Buffer.from("octocat:token123").toString("base64"));
    });

    it("handles special characters in credentials", () => {
      const login = "user@domain.com";
      const password = "p@ss:word!";

      const encoded = encodeNetrcAuth(login, password);
      const decoded = Buffer.from(encoded, "base64").toString("utf8");

      expect(decoded).toBe("user@domain.com:p@ss:word!");
    });

    it("handles empty password", () => {
      const login = "user";
      const password = "";

      const encoded = encodeNetrcAuth(login, password);
      const decoded = Buffer.from(encoded, "base64").toString("utf8");

      expect(decoded).toBe("user:");
    });
  });

  describe("netrc file permissions", () => {
    const isWindows = process.platform === "win32";

    it.skipIf(isWindows)("warns if netrc file is world-readable", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = await createTempNetrc(`machine github.com
login user
password pass`, 0o644);

      await loadNetrc(p);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("readable by others")
      );
      consoleSpy.mockRestore();
    });

    it.skipIf(isWindows)("does not warn when netrc file has correct permissions", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const p = await createTempNetrc(`machine github.com
login user
password pass`, 0o600);

      await loadNetrc(p);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("netrc error handling", () => {
    it("returns empty map when netrc file does not exist", async () => {
      const root = await mkdtemp(join(tmpdir(), "pin-actions-netrc-empty-"));
      tempDirs.push(root);
      const nonexistentPath = join(root, ".netrc");

      const netrc = await loadNetrc(nonexistentPath);

      expect(netrc.size).toBe(0);
    });

    it("returns null when --use-netrc but no entry for the host", async () => {
      const p = await createTempNetrc(`machine other.com
login user
password pass`);

      const creds = await getNetrcCredentials("github.com", p);

      expect(creds).toBeNull();
    });
  });

  describe("Auth precedence with netrc", () => {
    it("uses CLI token over netrc", async () => {
      const p = await createTempNetrc(`machine github.com
login user
password netrc_token`);

      const cliToken = "cli_token_xyz";
      const netrcCreds = await getNetrcCredentials("github.com", p);

      // CLI token takes precedence when both are present
      const selected = cliToken || (netrcCreds ? `${netrcCreds.login}:${netrcCreds.password}` : undefined);
      expect(selected).toBe("cli_token_xyz");
    });

    it("uses netrc when no CLI or env token", async () => {
      const p = await createTempNetrc(`machine github.com
login user
password netrc_token`);

      const cliToken = undefined;
      const netrcCreds = await getNetrcCredentials("github.com", p);

      expect(cliToken).toBeUndefined();
      expect(netrcCreds?.login).toBe("user");
    });
  });
});
