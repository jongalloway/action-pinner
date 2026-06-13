import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runActionMode } from "../src/action-mode.js";

const tempDirs: string[] = [];
const ACTION_ENV_KEYS = [
  "GITHUB_OUTPUT",
  "INPUT_ALLOW_ACTIONS",
  "INPUT_CONFIG",
  "INPUT_EXCLUDE_ACTION",
  "INPUT_EXCLUDE_PATH",
  "INPUT_EXCEPTION_RULES",
  "INPUT_INCLUDE_ACTION",
  "INPUT_JSON",
  "INPUT_MODE",
  "INPUT_PATH"
] as const;

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const key of ACTION_ENV_KEYS) {
    delete process.env[key];
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("runActionMode", () => {
  it("writes enforcement outputs for GitHub Actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
    tempDirs.push(root);

    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "ci.yml");
    await writeFile(
      workflowPath,
      [
        "jobs:",
        "  build:",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/cache@v4"
      ].join("\n"),
      "utf8"
    );

    const outputPath = join(root, "github-output.txt");
    const configPath = join(root, ".pin-actions.json");
    await writeFile(configPath, JSON.stringify({}, null, 2), "utf8");
    process.env.INPUT_MODE = "enforce";
    process.env.INPUT_CONFIG = configPath;
    process.env.INPUT_PATH = workflowPath;
    process.env.INPUT_ALLOW_ACTIONS = "actions/checkout";
    process.env.GITHUB_OUTPUT = outputPath;

    vi.spyOn(console, "log").mockImplementation(() => {});

    await runActionMode();

    const output = await readFile(outputPath, "utf8");
    expect(output).toContain("compliant=false");
    expect(output).toContain("allowed_count=1");
    expect(output).toContain("violation_count=1");
    expect(output).toContain("invalid_exception_count=0");
    expect(output).toContain("fingerprint=");
    expect(process.exitCode).toBe(1);
  });
});
