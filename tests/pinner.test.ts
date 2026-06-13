import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinReferences } from "../src/pinner.js";
import type { ActionReference, PinActionsConfig } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("pinReferences", () => {
  it("resolves each unique ref once and skips non-resolvable refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "pin-actions-"));
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
        "      - uses: actions/checkout@v4 # keep comment",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@1234567890abcdef1234567890abcdef12345678",
        "      - uses: ./local-action"
      ].join("\r\n"),
      "utf8"
    );

    const references: ActionReference[] = [
      makeReference(filePath, 4, "actions/checkout", "v4"),
      makeReference(filePath, 5, "actions/checkout", "v4"),
      makeReference(
        filePath,
        6,
        "actions/setup-node",
        "1234567890abcdef1234567890abcdef12345678",
        "pinned-sha"
      ),
      makeReference(filePath, 7, "./local-action", undefined, "local")
    ];

    const resolve = vi.fn().mockResolvedValue({
      original: "actions/checkout@v4",
      sha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc",
      comment: "v4",
      sourceRepo: "actions/checkout",
      resolutionMethod: "repos.getCommit",
      resolvedAt: "2026-06-09T19:00:00.000Z"
    });

    const patches = await pinReferences(
      references,
      { resolve },
      makeConfig(),
      true
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(patches).toHaveLength(1);
    expect(patches[0].referencesUpdated).toHaveLength(2);
    expect(patches[0].evidence).toHaveLength(2);
    expect(patches[0].originalContent).toContain("# keep comment");
    expect(patches[0].updatedContent).toContain("\r\n");
    expect(patches[0].updatedContent).toContain(
      "actions/checkout@fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc # v4 # keep comment"
    );
    expect(patches[0].updatedContent).toContain(
      "actions/setup-node@1234567890abcdef1234567890abcdef12345678"
    );
    expect(patches[0].updatedContent).toContain("- uses: ./local-action");
    expect(patches[0].evidence[0]).toMatchObject({
      filePath: filePath,
      line: 4,
      originalRef: "actions/checkout@v4",
      resolvedSha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc",
      sourceRepo: "actions/checkout",
      resolutionMethod: "repos.getCommit",
      resolvedAt: "2026-06-09T19:00:00.000Z"
    });
  });
});

function makeReference(
  filePath: string,
  line: number,
  action: string,
  ref: string | undefined,
  kind: ActionReference["kind"] = "tag-or-branch"
): ActionReference {
  return {
    filePath,
    line,
    raw: ref ? `${action}@${ref}` : action,
    action,
    ref,
    kind
  };
}

function makeConfig(): PinActionsConfig {
  return {
    mode: "fix",
    include: [],
    exclude: [],
    repos: [],
    includeRepos: [],
    excludeActions: [],
    excludeRepos: [],
    org: {
      includePrivate: false,
      includeArchived: false
    },
    pr: {
      create: false,
      branchPrefix: "chore/pin-actions",
      title: "Pin actions",
      labels: [],
      reviewers: [],
      assignees: []
    },
    enforcement: {
      enabled: false,
      failOnUnpinned: false,
      allowActions: [],
      exceptions: []
    },
    dependabot: {
      addVersionComments: true,
      generateConfigSnippet: false
    }
  };
}
