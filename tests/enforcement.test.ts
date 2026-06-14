import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("enforcement", () => {
  it("allows wildcard allowlisted actions to pass with exit code 0", async () => {
    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "allowed.yml", [
      "actions/checkout@v4",
      "actions/setup-node@v4"
    ]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        allowActions: ["actions/*"]
      }
    });

    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode ?? 0).toBe(0);
  });

  it("fails non-allowlisted unpinned refs", async () => {
    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "violating.yml", ["evilcorp/build@main"]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        allowActions: ["actions/*"]
      }
    });

    const logs = captureLogs();
    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    expect(logs.output).toContain("evilcorp/build@main");
  });

  it("allows valid time-bounded exceptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T20:16:50.714Z"));

    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "legacy.yml", ["evilcorp/build@main"]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        allowActions: [],
        exceptions: [
          {
            action: "evilcorp/build",
            ref: "main",
            workflow: "**/legacy.yml",
            reason: "Temporary migration exception",
            expiresAt: "2026-12-31T00:00:00.000Z"
          }
        ]
      }
    });

    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode ?? 0).toBe(0);
  });

  it("fails closed when exceptions are expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T20:16:50.714Z"));

    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "legacy.yml", ["evilcorp/build@main"]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        allowActions: [],
        exceptions: [
          {
            action: "evilcorp/build",
            ref: "main",
            workflow: "**/legacy.yml",
            reason: "Expired exception should not allow this ref",
            expiresAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }
    });

    const logs = captureLogs();
    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    expect(logs.output).toContain("evilcorp/build@main");
  });

  it("fails closed when exceptions are malformed", async () => {
    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "legacy.yml", ["evilcorp/build@main"]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        exceptions: [
          {
            action: "evilcorp/build",
            ref: "main",
            workflow: "**/legacy.yml",
            expiresAt: "not-a-date"
          }
        ]
      }
    });

    const logs = captureLogs();
    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    expect(logs.output).toContain("Invalid or expired exceptions");
    expect(logs.output).toContain("expiresAt");
  });

  it("reports allowed and violating refs distinctly in text output", async () => {
    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "mixed.yml", [
      "actions/checkout@v4",
      "evilcorp/build@main"
    ]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        allowActions: ["actions/*"]
      }
    });

    const logs = captureLogs();
    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    expect(logs.output.toLowerCase()).toContain("allowed");
    expect(logs.output.toLowerCase()).toContain("violations");
    expect(logs.output).toContain("actions/checkout@v4");
    expect(logs.output).toContain("evilcorp/build@main");
  });

  it("treats an empty allowlist as deny-by-default", async () => {
    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "deny-default.yml", ["actions/checkout@v4"]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        allowActions: []
      }
    });

    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
  });

  it("fails when every matching exception has expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T20:16:50.714Z"));

    const root = await createTempRepo();
    const workflowPath = await writeWorkflow(root, "legacy.yml", [
      "evilcorp/build@main",
      "evilcorp/deploy@main"
    ]);
    const configPath = await writeConfig(root, {
      enforcement: {
        enabled: true,
        failOnUnpinned: true,
        exceptions: [
          {
            action: "evilcorp/build",
            ref: "main",
            workflow: "**/legacy.yml",
            expiresAt: "2025-12-31T00:00:00.000Z"
          },
          {
            action: "evilcorp/deploy",
            ref: "main",
            workflow: "**/legacy.yml",
            expiresAt: "2026-01-15T00:00:00.000Z"
          }
        ]
      }
    });

    const logs = captureLogs();
    await runCli(["enforce", "--config", configPath, "--path", workflowPath]);

    expect(process.exitCode).toBe(1);
    expect(logs.output).toContain("evilcorp/build@main");
    expect(logs.output).toContain("evilcorp/deploy@main");
  });
});

function captureLogs() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    lines.push(args.join(" "));
  });
  return {
    get output() {
      return lines.join("\n");
    }
  };
}

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "action-pinner-"));
  tempDirs.push(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  return root;
}

async function writeWorkflow(root: string, name: string, usesRefs: string[]): Promise<string> {
  const filePath = join(root, ".github", "workflows", name);
  await writeFile(
    filePath,
    ["jobs:", "  build:", "    steps:", ...usesRefs.map((ref) => `      - uses: ${ref}`)].join(
      "\n"
    ),
    "utf8"
  );
  return filePath;
}

async function writeConfig(root: string, config: Record<string, unknown>): Promise<string> {
  const configPath = join(root, ".action-pinner.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}
