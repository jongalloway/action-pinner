import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { platform } from "node:os";

export interface NetrcCredentials {
  login: string;
  password: string;
}

export async function loadNetrc(overridePath?: string): Promise<Map<string, NetrcCredentials>> {
  const netrcPath = overridePath ?? getNetrcPath();
  const credentials = new Map<string, NetrcCredentials>();

  try {
    const content = await readFile(netrcPath, "utf8");

    // Warn if .netrc is world-readable (security issue)
    try {
      const stats = statSync(netrcPath);
      // eslint-disable-next-line no-bitwise
      if ((stats.mode & 0o077) !== 0) {
        console.warn(
          `Warning: ${netrcPath} is readable by others. Fix with: chmod 600 ${netrcPath}`
        );
      }
    } catch {
      // Ignore stat errors
    }

    const lines = content.split("\n");
    let currentMachine: string | null = null;
    let currentLogin: string | null = null;
    let currentPassword: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const parts = trimmed.split(/\s+/);
      let i = 0;
      while (i < parts.length) {
        const key = parts[i];
        i += 1;

        if (key === "machine") {
          const value = parts[i];
          if (value) {
            if (currentMachine && currentLogin && currentPassword) {
              credentials.set(currentMachine, {
                login: currentLogin,
                password: currentPassword
              });
            }
            currentMachine = value;
            currentLogin = null;
            currentPassword = null;
          }
          i += 1;
        } else if (key === "login") {
          currentLogin = parts[i] ?? null;
          i += 1;
        } else if (key === "password") {
          // Capture the rest of the line to handle passwords containing spaces
          const passwordTokens = parts.slice(i);
          currentPassword = passwordTokens.length > 0 ? passwordTokens.join(" ") : null;
          break;
        }
      }
    }

    if (currentMachine && currentLogin && currentPassword) {
      credentials.set(currentMachine, {
        login: currentLogin,
        password: currentPassword
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ENOENT")) {
      console.warn(`Failed to load netrc from ${netrcPath}: ${message}`);
    }
  }

  return credentials;
}

export async function getNetrcCredentials(
  host: string,
  overridePath?: string
): Promise<NetrcCredentials | null> {
  const credentials = await loadNetrc(overridePath);

  // Exact match
  if (credentials.has(host)) {
    return credentials.get(host) ?? null;
  }

  // Try wildcard matching for subdomains (e.g., *.github.com matches api.github.com)
  for (const [machine, creds] of credentials.entries()) {
    if (machine.startsWith("*.") && host.endsWith(machine.substring(1))) {
      return creds;
    }
  }

  return null;
}

export function getNetrcPath(): string {
  const home = homedir();
  if (platform() === "win32") {
    return join(home, "_netrc");
  }
  return resolve(home, ".netrc");
}

export function encodeNetrcAuth(login: string, password: string): string {
  const credentials = `${login}:${password}`;
  return Buffer.from(credentials).toString("base64");
}

export interface OctokitAuth {
  auth?: string | Record<string, unknown>;
}

export async function applyNetrcAuth(
  client: OctokitAuth,
  host: string
): Promise<void> {
  const creds = await getNetrcCredentials(host);

  if (creds) {
    // Use login:password format as expected by Octokit's basic auth strategy
    client.auth = `${creds.login}:${creds.password}`;
  }
}

export function redactNetrcAuth(auth: string | undefined): string {
  if (!auth) {
    return "none";
  }
  if (auth.startsWith("Basic ")) {
    return "netrc";
  }
  // Detect login:password format used by netrc/basic auth
  if (auth.includes(":") && !auth.startsWith("token ")) {
    return "netrc";
  }
  return "token (redacted)";
}
