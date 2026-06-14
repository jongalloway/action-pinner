import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("loadConfig", () => {
  it("loads valid config values", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          mode: "fix",
          include: [".github/workflows/**/*.yml"],
          exclude: [".github/workflows/legacy/**"],
          repos: ["octo-org/service-a"],
          includeRepos: ["platform-*"],
          org: {
            name: "octocat",
            type: "user",
            includePrivate: true,
            includeArchived: false
          },
          excludeActions: ["actions/cache"],
          pr: {
            create: false,
            branchPrefix: "chore/pin-actions",
            title: "Pin",
            labels: ["security"],
            reviewers: ["octocat"],
            assignees: ["hubot"]
          },
          enforcement: {
            enabled: true,
            failOnUnpinned: true,
            allowActions: ["actions/*"],
            exceptions: [
              {
                action: "actions/upload-artifact",
                ref: "v3",
                workflow: "**/legacy.yml",
                reason: "temporary exception",
                justification: "Legacy runner migration",
                expiresAt: "2099-12-31"
              }
            ]
          },
          dependabot: {
            addVersionComments: true,
            commentFormat: "pin@{ref}",
            generateConfigSnippet: false
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const config = await loadConfig(configPath);
    expect(config.mode).toBe("fix");
    expect(config.include).toEqual([".github/workflows/**/*.yml"]);
    expect(config.exclude).toEqual([".github/workflows/legacy/**"]);
    expect(config.repos).toEqual(["octo-org/service-a"]);
    expect(config.includeRepos).toEqual(["platform-*"]);
    expect(config.org.name).toBe("octocat");
    expect(config.org.type).toBe("user");
    expect(config.excludeActions).toEqual(["actions/cache"]);
    expect(config.pr.create).toBe(false);
    expect(config.pr.labels).toEqual(["security"]);
    expect(config.pr.reviewers).toEqual(["octocat"]);
    expect(config.pr.assignees).toEqual(["hubot"]);
    expect(config.enforcement.allowActions).toEqual(["actions/*"]);
    expect(config.enforcement.exceptions).toHaveLength(1);
    expect(config.enforcement.exceptions[0].justification).toBe("Legacy runner migration");
    expect(config.enforcement.exceptions[0].expiresAt).toBe("2099-12-31");
    expect(config.dependabot.commentFormat).toBe("pin@{ref}");
  });

  it("defaults commentFormat to {ref}", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(configPath, JSON.stringify({}), "utf8");

    const config = await loadConfig(configPath);
    expect(config.dependabot.commentFormat).toBe("{ref}");
  });

  it("fails on invalid top-level keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(configPath, JSON.stringify({ invalid: true }), "utf8");

    await expect(loadConfig(configPath)).rejects.toThrow(
      "unknown property 'invalid'"
    );
  });

  it("fails on invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(configPath, "{", "utf8");

    await expect(loadConfig(configPath)).rejects.toThrow("Invalid JSON");
  });

  it("fails on malformed enforcement exceptions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify({
        enforcement: {
          exceptions: [{ ref: "v4" }]
        }
      }),
      "utf8"
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      "enforcement.exceptions[0].action"
    );
  });

  it("fails with clear message for invalid include type", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(configPath, JSON.stringify({ include: "not-an-array" }), "utf8");

    await expect(loadConfig(configPath)).rejects.toThrow(
      "'include' must be an array of strings."
    );
  });

  it("fails with clear message for invalid enforcement type", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify({ enforcement: { failOnUnpinned: "yes" } }),
      "utf8"
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      "'enforcement.failOnUnpinned' must be a boolean."
    );
  });

  it("fails with clear message for unsupported enforcement allowlist keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify({ enforcement: { enabled: true, allowlist: ["actions/checkout"] } }),
      "utf8"
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      "unknown property 'enforcement.allowlist'"
    );
  });

  it("fails with clear message for invalid dependabot commentFormat type", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(
      configPath,
      JSON.stringify({ dependabot: { commentFormat: true } }),
      "utf8"
    );

    await expect(loadConfig(configPath)).rejects.toThrow(
      "'dependabot.commentFormat' must be a string."
    );
  });

  it("fails on invalid org type", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const configPath = join(root, ".pin-actions.json");
    await writeFile(configPath, JSON.stringify({ org: { type: "team" } }), "utf8");

    await expect(loadConfig(configPath)).rejects.toThrow(
      "'org.type' must be either 'org' or 'user'"
    );
  });
});
