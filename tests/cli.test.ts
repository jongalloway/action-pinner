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
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
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

  it("applies --comment-format to fix dry runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const filePath = join(workflowDir, "ci.yml");
    await writeFile(
      filePath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    vi.spyOn(ActionResolver.prototype, "resolve").mockResolvedValue({
      original: "actions/checkout@v4",
      sha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc",
      comment: "legacy-comment",
      sourceRepo: "actions/checkout",
      resolutionMethod: "repos.getCommit",
      resolvedAt: "2026-06-09T19:00:00.000Z"
    });

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    await runCli([
      "fix",
      "--dry-run",
      "--path",
      filePath,
      "--comment-format",
      "pin@{ref}"
    ]);

    expect(logs.join("\n")).toContain(
      "+       - uses: actions/checkout@fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc # pin@v4"
    );
  });

  it("enforce exits non-zero by default when unpinned refs are found", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
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
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
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

    const configPath = join(root, ".action-pinner.json");
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
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
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

    const configPath = join(root, ".action-pinner.json");
    await writeFile(
      configPath,
      JSON.stringify({ include: [join(workflowDir, "*.yml")] }, null, 2),
      "utf8"
    );

    process.exitCode = undefined;
    await runCli(["enforce", "--config", configPath, "--path", pinnedPath]);
    expect(process.exitCode).toBeUndefined();
  });

  it("enforce reports allowlisted refs as allowed in JSON output", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "allowed.yml");
    await writeFile(
      workflowPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    await runCli([
      "enforce",
      "--json",
      "--path",
      workflowPath,
      "--allow-action",
      "actions/checkout"
    ]);

    expect(process.exitCode).toBeUndefined();
    const output = JSON.parse(logs[0]);
    expect(output.compliant).toBe(true);
    expect(output.summary.allowedCount).toBe(1);
    expect(output.summary.violationCount).toBe(0);
    expect(output.allowed).toHaveLength(1);
    expect(output.allowed[0].reason).toBe("allowlist");
  });

  it("enforce supports markdown report output", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "unpinned.yml");
    await writeFile(
      workflowPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    process.exitCode = undefined;
    await runCli(["enforce", "--report", "markdown", "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    const output = logs.join("\n");
    expect(output).toContain("# action-pinner enforce report");
    expect(output).toContain("actions/checkout@v4");
    expect(output).toContain("| File | Line | Action |");
    expect(output).toContain("## Run fingerprint");
    process.exitCode = undefined;
  });

  it("enforce fails closed on expired exceptions with clear messaging", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "legacy.yml");
    await writeFile(
      workflowPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/upload-artifact@v4"
      ].join("\n"),
      "utf8"
    );

    const configPath = join(root, ".action-pinner.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          enforcement: {
            exceptions: [
              {
                action: "actions/upload-artifact",
                ref: "v4",
                workflow: "**/legacy.yml",
                justification: "Legacy workflow still migrating",
                expiresAt: "2000-01-01"
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    const output = logs.join("\n");
    expect(output).toContain("Enforcement failed.");
    expect(output).toContain("Invalid or expired exceptions:");
    expect(output).toContain("expired at 2000-01-01");
    expect(output).toContain("Violations:");
  });
});
