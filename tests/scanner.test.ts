import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanWorkflows } from "../src/scanner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("scanWorkflows", () => {
  it("detects unpinned actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "ci.yml"),
      [
        "name: test",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@4f1d2f6f0deecfdbf31e6f2adf8a4208f7f4d657"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows([".github/workflows/**/*.yml"], root);
    expect(result.summary.filesScanned).toBe(1);
    expect(result.summary.referencesFound).toBe(2);
    expect(result.summary.unpinnedFound).toBe(1);
    expect(result.references).toHaveLength(2);
    expect(result.unpinned).toHaveLength(1);
    expect(result.unpinned[0].raw).toBe("actions/checkout@v4");
    expect(result.unpinned[0].line).toBe(6);
  });

  it("defaults to .github/workflows when no patterns are provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "ci.yaml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/setup-node@v4"
      ].join("\n"),
      "utf8"
    );
    await mkdir(join(root, "repo-b", ".github", "workflows"), { recursive: true });
    await writeFile(
      join(root, "repo-b", ".github", "workflows", "ignored.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows([], root);
    expect(result.summary.filesScanned).toBe(1);
    expect(result.references).toHaveLength(1);
    expect(result.unpinned).toHaveLength(1);
    expect(result.unpinned[0].raw).toBe("actions/setup-node@v4");
  });

  it("scans multi-repo paths with deterministic ordering", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const repoBWorkflowDir = join(root, "repos", "repo-b", ".github", "workflows");
    const repoAWorkflowDir = join(root, "repos", "repo-a", ".github", "workflows");
    await mkdir(repoBWorkflowDir, { recursive: true });
    await mkdir(repoAWorkflowDir, { recursive: true });

    await writeFile(
      join(repoBWorkflowDir, "build.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/setup-node@v4"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(repoAWorkflowDir, "build.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows(
      ["repos/repo-b/.github/workflows/**/*.yml", "repos/repo-a/.github/workflows/**/*.yml"],
      root
    );

    expect(result.summary.filesScanned).toBe(2);
    expect(result.unpinned).toHaveLength(2);
    expect(result.unpinned.map((entry) => entry.filePath.replace(/\\/g, "/"))).toEqual([
      join(repoAWorkflowDir, "build.yml").replace(/\\/g, "/"),
      join(repoBWorkflowDir, "build.yml").replace(/\\/g, "/")
    ]);
  });

  it("applies include/exclude filters deterministically across edge-case ordering", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, "included.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(workflowDir, "excluded.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/setup-node@v4"
      ].join("\n"),
      "utf8"
    );

    const includeThenExclude = await scanWorkflows(
      [".github/workflows/**/*.yml", "!**/excluded.yml"],
      root
    );
    const excludeThenInclude = await scanWorkflows(
      ["!**/excluded.yml", ".github/workflows/**/*.yml"],
      root
    );

    expect(includeThenExclude.summary.filesScanned).toBe(1);
    expect(excludeThenInclude.summary.filesScanned).toBe(1);
    expect(includeThenExclude.unpinned).toHaveLength(1);
    expect(excludeThenInclude.unpinned).toHaveLength(1);
    expect(includeThenExclude.unpinned[0].raw).toBe("actions/checkout@v4");
    expect(excludeThenInclude.unpinned[0].raw).toBe("actions/checkout@v4");
  });

  it("normalizes Windows-style workflow globs", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "ci.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows([".github\\workflows\\**\\*.yml"], root);
    expect(result.summary.filesScanned).toBe(1);
    expect(result.references).toHaveLength(1);
    expect(result.unpinned[0].raw).toBe("actions/checkout@v4");
  });

  it("expands workflow directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "ci.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows([".github\\workflows"], root);
    expect(result.summary.filesScanned).toBe(1);
    expect(result.references).toHaveLength(1);
    expect(result.unpinned[0].raw).toBe("actions/checkout@v4");
  });

  it("supports path and action filters", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(join(workflowDir, "legacy"), { recursive: true });

    await writeFile(
      join(workflowDir, "main.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/cache@v4"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      join(workflowDir, "legacy", "legacy.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/setup-node@v4"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows([".github/workflows/**/*.yml"], root, {
      excludePatterns: [".github/workflows/legacy/**"],
      includeActions: ["actions/*"],
      excludeActions: ["actions/cache"]
    });

    expect(result.summary.filesScanned).toBe(1);
    expect(result.references).toHaveLength(1);
    expect(result.unpinned).toHaveLength(1);
    expect(result.unpinned[0].action).toBe("actions/checkout");
  });

  it("applies include/exclude action filters deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "ci.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/cache@v4",
        "      - uses: github/codeql-action/init@v3"
      ].join("\n"),
      "utf8"
    );

    const result = await scanWorkflows([".github/workflows/**/*.yml"], root, {
      includeActions: ["actions/*", "github/codeql-action/*"],
      excludeActions: ["actions/cache"]
    });

    expect(result.references.map((reference) => reference.action)).toEqual([
      "actions/checkout",
      "github/codeql-action/init"
    ]);
    expect(result.unpinned.map((reference) => reference.action)).toEqual([
      "actions/checkout",
      "github/codeql-action/init"
    ]);
  });
});
