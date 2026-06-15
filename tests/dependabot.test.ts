import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateDependabotActionsSnippet } from "../src/dependabot.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("generateDependabotActionsSnippet", () => {
  it("generates a snippet from discovered workflow actions", async () => {
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
        "      - uses: actions/setup-node@v4",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/checkout@v4",
        "      - uses: ./.github/actions/local-only"
      ].join("\n"),
      "utf8"
    );

    const snippet = await generateDependabotActionsSnippet({ cwd: root });

    expect(snippet).toContain("version: 2");
    expect(snippet).toContain("updates:");
    expect(snippet).toContain("  # Covers: actions/checkout, actions/setup-node");
    expect(snippet).toContain("  - package-ecosystem: github-actions");
    expect(snippet).toContain("    directory: /.github/workflows");
    expect(snippet).toContain("      interval: weekly");
    expect(snippet).not.toContain("local-only");
  });

  it("creates one github-actions entry per unique workflow directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const primaryWorkflowDir = join(root, ".github", "workflows");
    const packageWorkflowDir = join(root, "packages", "api", ".github", "workflows");
    await mkdir(primaryWorkflowDir, { recursive: true });
    await mkdir(packageWorkflowDir, { recursive: true });

    await writeFile(
      join(primaryWorkflowDir, "ci.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(packageWorkflowDir, "release.yml"),
      [
        "jobs:",
        "  release:",
        "    steps:",
        "      - uses: actions/setup-node@v4"
      ].join("\n"),
      "utf8"
    );

    const snippet = await generateDependabotActionsSnippet({
      cwd: root,
      includePatterns: [".github/workflows", "packages/api/.github/workflows"]
    });

    expect(snippet.match(/package-ecosystem: github-actions/g)).toHaveLength(2);
    expect(snippet).toContain("    directory: /.github/workflows");
    expect(snippet).toContain("    directory: /packages/api/.github/workflows");
    expect(snippet).toContain("  # Covers: actions/checkout");
    expect(snippet).toContain("  # Covers: actions/setup-node");
  });

  it("reports missing github-actions directories in check mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const primaryWorkflowDir = join(root, ".github", "workflows");
    const packageWorkflowDir = join(root, "packages", "api", ".github", "workflows");
    await mkdir(primaryWorkflowDir, { recursive: true });
    await mkdir(packageWorkflowDir, { recursive: true });

    await writeFile(
      join(primaryWorkflowDir, "ci.yml"),
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(packageWorkflowDir, "release.yml"),
      [
        "jobs:",
        "  release:",
        "    steps:",
        "      - uses: actions/setup-node@v4"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      join(root, ".github", "dependabot.yml"),
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: github-actions",
        "    directory: /.github/workflows",
        "    schedule:",
        "      interval: weekly"
      ].join("\n"),
      "utf8"
    );

    const snippet = await generateDependabotActionsSnippet({
      cwd: root,
      includePatterns: [".github/workflows", "packages/api/.github/workflows"],
      check: true
    });

    expect(snippet).toContain(
      "# .github/dependabot.yml exists, but it is missing these github-actions directories:"
    );
    expect(snippet).toContain("#   - /packages/api/.github/workflows");
    expect(snippet).toContain("    directory: /packages/api/.github/workflows");
  });

  it("falls back to the default snippet when no workflows are discovered", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
    tempDirs.push(root);

    const snippet = await generateDependabotActionsSnippet({ cwd: root });

    expect(snippet).toBe(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: github-actions",
        "    directory: /",
        "    schedule:",
        "      interval: weekly"
      ].join("\n")
    );
  });

  it("treats a malformed dependabot.yml as unreadable and generates a full snippet", async () => {
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

    const githubDir = join(root, ".github");
    await mkdir(githubDir, { recursive: true });
    await writeFile(join(githubDir, "dependabot.yml"), ": invalid: yaml: [", "utf8");

    const snippet = await generateDependabotActionsSnippet({
      cwd: root,
      check: true
    });

    expect(snippet).toContain("# .github/dependabot.yml could not be parsed (malformed YAML); treating it as unreadable.");
    expect(snippet).toContain("version: 2");
    expect(snippet).toContain("  - package-ecosystem: github-actions");
    expect(snippet).toContain("    directory: /.github/workflows");
  });
});
