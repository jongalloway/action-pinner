import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { ActionResolver } from "../src/resolver.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("runCli", () => {
  it("prints a dry-run diff preview without changing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const filePath = join(workflowDir, "ci.yml");
    const originalContent = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v4 # keep comment"
    ].join("\r\n");
    await writeFile(filePath, originalContent, "utf8");

    vi.spyOn(ActionResolver.prototype, "resolve").mockResolvedValue({
      original: "actions/checkout@v4",
      sha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc",
      comment: "v4",
      sourceRepo: "actions/checkout",
      resolutionMethod: "repos.getCommit",
      resolvedAt: "2026-06-09T19:00:00.000Z"
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    await runCli(["fix", "--dry-run", "--path", filePath]);

    expect(logs.join("\n")).toContain("Dry run complete. 1 file(s) would be updated across 1 reference(s).");
    expect(logs.join("\n")).toContain("--- ");
    expect(logs.join("\n")).toContain("ci.yml ---");
    expect(logs.join("\n")).toContain("@@ line 4 @@");
    expect(logs.join("\n")).toContain("actions/checkout@v4 # keep comment");
    expect(logs.join("\n")).toContain(
      "+       - uses: actions/checkout@fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc # v4 # keep comment"
    );
    expect(logs.join("\n")).toContain("Evidence:");
    expect(logs.join("\n")).toContain("source=actions/checkout");
    expect(logs.join("\n")).toContain("Run fingerprint:");
    expect(logs.join("\n")).toContain("Tool version:");
    expect(await readFile(filePath, "utf8")).toBe(originalContent);
  });

  it("enforce exits non-zero by default when unpinned refs are found", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const unpinnedPath = join(workflowDir, "unpinned.yml");
    await writeFile(
      unpinnedPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    process.exitCode = undefined;
    await runCli(["enforce", "--path", unpinnedPath]);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it("enforce honors failOnUnpinned=false exception from config", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const unpinnedPath = join(workflowDir, "unpinned.yml");
    await writeFile(
      unpinnedPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify({ enforcement: { failOnUnpinned: false } }, null, 2),
      "utf8"
    );

    process.exitCode = undefined;
    await runCli(["enforce", "--config", configPath, "--path", unpinnedPath]);
    expect(process.exitCode).toBeUndefined();
  });

  it("enforce allows CLI path allowlist to override broader config include", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const unpinnedPath = join(workflowDir, "unpinned.yml");
    const pinnedPath = join(workflowDir, "pinned.yml");
    await writeFile(
      unpinnedPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      pinnedPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@1234567890abcdef1234567890abcdef12345678"
      ].join("\n"),
      "utf8"
    );

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify({ include: [join(workflowDir, "*.yml")] }, null, 2),
      "utf8"
    );

    process.exitCode = undefined;
    await runCli(["enforce", "--config", configPath, "--path", pinnedPath]);
    expect(process.exitCode).toBeUndefined();
  });
});
