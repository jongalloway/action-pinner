import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadNetrc, getNetrcCredentials, encodeNetrcAuth, getNetrcPath } from "../src/netrc-auth.js";

describe("netrc Authentication", () => {
  let tempDirs: string[] = [];
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  async function createTempHome(netrcContent: string, mode = 0o600): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-netrc-"));
    tempDirs.push(root);
    const netrcPath = join(root, ".netrc");
    await writeFile(netrcPath, netrcContent, "utf8");
    await chmod(netrcPath, mode);
    process.env.HOME = root;
    return root;
  }

  describe("netrc parsing", () => {
    it("parses single machine entry", async () => {
      await createTempHome(`machine github.com
login octocat
password my_personal_token`);

      const netrc = await loadNetrc();

      expect(netrc.has("github.com")).toBe(true);
      expect(netrc.get("github.com")).toEqual({
        login: "octocat",
        password: "my_personal_token"
      });
    });

    it("parses multiple machine entries", async () => {
      await createTempHome(`machine github.com
login octocat
password token1

machine enterprise.example.com
login alice
password token2`);

      const netrc = await loadNetrc();

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
      await createTempHome(`machine github.com
login user123
password pass456`);

      const netrc = await loadNetrc();
      const entry = netrc.get("github.com");

      expect(entry?.login).toBe("user123");
      expect(entry?.password).toBe("pass456");
    });

    it("handles passwords with spaces", async () => {
      await createTempHome(`machine github.com
login user
password my pass with spaces`);

      const netrc = await loadNetrc();
      const entry = netrc.get("github.com");

      expect(entry?.password).toBe("my pass with spaces");
    });

    it("ignores comments in netrc file", async () => {
      await createTempHome(`# This is a comment
machine github.com
login octocat
# Another comment
password token123`);

      const netrc = await loadNetrc();
      expect(netrc.get("github.com")).toBeDefined();
      expect(netrc.get("github.com")?.login).toBe("octocat");
    });

    it("handles empty lines gracefully", async () => {
      await createTempHome(`machine github.com
login user

password pass

machine other.com
login other_user
password other_pass`);

      const netrc = await loadNetrc();
      expect(netrc.size).toBe(2);
    });

    it("parses inline format (machine/login/password on one line)", async () => {
      await createTempHome("machine github.com login octocat password ghp_token123");

      const netrc = await loadNetrc();
      const entry = netrc.get("github.com");

      expect(entry?.login).toBe("octocat");
      expect(entry?.password).toBe("ghp_token123");
    });
  });

  describe("netrc lookup", () => {
    it("finds credentials for exact host match", async () => {
      await createTempHome(`machine github.com
login octocat
password token123`);

      const creds = await getNetrcCredentials("github.com");

      expect(creds).toEqual({
        login: "octocat",
        password: "token123"
      });
    });

    it("returns null for host not in netrc", async () => {
      await createTempHome(`machine github.com
login octocat
password token123`);

      const creds = await getNetrcCredentials("enterprise.example.com");

      expect(creds).toBeNull();
    });

    it("matches wildcard entries for subdomains", async () => {
      await createTempHome(`machine *.github.com
login user
password pass`);

      const creds = await getNetrcCredentials("api.github.com");

      expect(creds).not.toBeNull();
      expect(creds?.login).toBe("user");
    });

    it("prioritizes exact match over wildcard", async () => {
      await createTempHome(`machine *.github.com
login wildcard_user
password wildcard_pass

machine api.github.com
login exact_user
password exact_pass`);

      const creds = await getNetrcCredentials("api.github.com");

      expect(creds?.login).toBe("exact_user");
    });

    it("handles multiple GHES instances", async () => {
      await createTempHome(`machine github.com
login user1
password token1

machine enterprise1.example.com
login user2
password token2

machine enterprise2.example.com
login user3
password token3`);

      expect((await getNetrcCredentials("enterprise1.example.com"))?.login).toBe("user2");
      expect((await getNetrcCredentials("enterprise2.example.com"))?.login).toBe("user3");
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
    it("warns if netrc file is world-readable", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await createTempHome(`machine github.com
login user
password pass`, 0o644);

      await loadNetrc();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("readable by others")
      );
      consoleSpy.mockRestore();
    });

    it("does not warn when netrc file has correct permissions", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await createTempHome(`machine github.com
login user
password pass`, 0o600);

      await loadNetrc();

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("netrc error handling", () => {
    it("returns empty map when netrc file does not exist", async () => {
      const root = await mkdtemp(join(tmpdir(), "pin-actions-netrc-empty-"));
      tempDirs.push(root);
      process.env.HOME = root;

      const netrc = await loadNetrc();

      expect(netrc.size).toBe(0);
    });

    it("returns null when --use-netrc but no entry for the host", async () => {
      await createTempHome(`machine other.com
login user
password pass`);

      const creds = await getNetrcCredentials("github.com");

      expect(creds).toBeNull();
    });
  });

  describe("Auth precedence with netrc", () => {
    it("uses CLI token over netrc", async () => {
      await createTempHome(`machine github.com
login user
password netrc_token`);

      const cliToken = "cli_token_xyz";
      const netrcCreds = await getNetrcCredentials("github.com");

      // CLI token takes precedence when both are present
      const selected = cliToken || (netrcCreds ? `${netrcCreds.login}:${netrcCreds.password}` : undefined);
      expect(selected).toBe("cli_token_xyz");
    });

    it("uses netrc when no CLI or env token", async () => {
      await createTempHome(`machine github.com
login user
password netrc_token`);

      const cliToken = undefined;
      const netrcCreds = await getNetrcCredentials("github.com");

      expect(cliToken).toBeUndefined();
      expect(netrcCreds?.login).toBe("user");
    });
  });
});
