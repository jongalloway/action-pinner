import { readFile } from "node:fs/promises";

let versionPromise: Promise<string> | undefined;

export function getToolVersion(): Promise<string> {
  versionPromise ??= readPackageVersion();
  return versionPromise;
}

async function readPackageVersion(): Promise<string> {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(packageJson) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("Unable to determine tool version from package.json.");
  }

  return parsed.version;
}
