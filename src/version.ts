import { readFile } from "node:fs/promises";

let versionPromise: Promise<string> | undefined;

export function getToolVersion(): Promise<string> {
  versionPromise ??= readPackageVersion();
  return versionPromise;
}

async function readPackageVersion(): Promise<string> {
  for (const relativePath of ["../package.json", "../../package.json"]) {
    try {
      const packageJson = await readFile(new URL(relativePath, import.meta.url), "utf8");
      const parsed = JSON.parse(packageJson) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch {
      // Try the next known package.json location.
    }
  }

  throw new Error("Unable to determine tool version from package.json.");
}
