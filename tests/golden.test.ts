import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinReferences } from "../src/pinner.js";
import { formatEvidence } from "../src/report.js";
import { ActionResolver } from "../src/resolver.js";
import { formatEvidenceHtml, formatEvidenceMarkdown } from "../src/table-formatter.js";
import type {
  ActionReference,
  FilePatch,
  PinActionsConfig,
  PinEvidence,
  ResolutionResult
} from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("golden outputs", () => {
  it("snapshots resolver results for a mutable action ref", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T23:37:14.238Z"));

    const getCommit = vi.fn().mockResolvedValue({
      data: { sha: "34e11487abcdef0123456789abcdef0123456789" }
    });
    const resolver = new ActionResolver(undefined, {
      repos: { getCommit }
    });

    await expect(resolver.resolve(makeReference("workflow.yml", 7, "actions/checkout", "v4")))
      .resolves.toMatchInlineSnapshot(`
        {
          "comment": "v4",
          "githubApiUrl": "https://api.github.com",
          "original": "actions/checkout@v4",
          "resolutionMethod": "repos.getCommit",
          "resolvedAt": "2026-08-17T23:37:14.238Z",
          "sha": "34e11487abcdef0123456789abcdef0123456789",
          "sourceRepo": "actions/checkout",
        }
      `);
    expect(getCommit).toHaveBeenCalledWith({
      owner: "actions",
      repo: "checkout",
      ref: "v4"
    });
  });

  it("snapshots rewrite output for mixed workflow uses syntax", async () => {
    const root = await mkdtemp(join(tmpdir(), "action-pinner-golden-"));
    tempDirs.push(root);
    const workflowDir = join(root, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    const workflowPath = join(workflowDir, "ci.yml");
    await writeFile(
      workflowPath,
      [
        "name: CI",
        "on: [push]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4 # existing comment",
        "      - uses: 'actions/setup-node@v4'",
        "      - uses: docker://alpine:3.20",
        "      - uses: ./local-action"
      ].join("\n"),
      "utf8"
    );

    const patches = await pinReferences(
      [
        makeReference(workflowPath, 7, "actions/checkout", "v4"),
        makeReference(workflowPath, 8, "actions/setup-node", "v4"),
        makeReference(workflowPath, 9, "docker://alpine:3.20", undefined, "docker"),
        makeReference(workflowPath, 10, "./local-action", undefined, "local")
      ],
      makeResolver({
        "actions/checkout@v4": {
          sha: "34e11487abcdef0123456789abcdef0123456789",
          resolvedAt: "2026-08-17T23:37:14.238Z"
        },
        "actions/setup-node@v4": {
          sha: "49933ea5fedcba9876543210fedcba9876543210",
          resolvedAt: "2026-08-17T23:37:14.238Z"
        }
      }),
      makeConfig(),
      true
    );

    expect(patches).toHaveLength(1);
    expect(patches[0].updatedContent).toMatchInlineSnapshot(`
      "name: CI
      on: [push]
      jobs:
        build:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@34e11487abcdef0123456789abcdef0123456789 # v4 # existing comment
            - uses: 'actions/setup-node@49933ea5fedcba9876543210fedcba9876543210' # v4
            - uses: docker://alpine:3.20
            - uses: ./local-action"
    `);
  });

  it("snapshots evidence and report content", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T23:37:14.238Z"));

    const patches: FilePatch[] = [
      makePatch("release.yml", [
        makeEvidence("release.yml", 10, "github/codeql-action/init@v3", "1111111111111111111111111111111111111111")
      ]),
      makePatch("ci.yml", [
        makeEvidence("ci.yml", 8, "actions/setup-node@v4", "49933ea5fedcba9876543210fedcba9876543210"),
        makeEvidence("ci.yml", 7, "actions/checkout@v4", "34e11487abcdef0123456789abcdef0123456789")
      ])
    ];
    const evidence = patches.flatMap((patch) => patch.evidence);
    const fingerprint = {
      toolVersion: "0.2.1",
      configHash: "a".repeat(64),
      fingerprint: "b".repeat(64)
    };

    expect(formatEvidence(patches)).toMatchInlineSnapshot(`
      "- .github/workflows/ci.yml:7 actions/checkout@v4 -> 34e11487abcdef0123456789abcdef0123456789 (source=actions/checkout, method=repos.getCommit, resolvedAt=2026-08-17T23:37:14.238Z)
      - .github/workflows/ci.yml:8 actions/setup-node@v4 -> 49933ea5fedcba9876543210fedcba9876543210 (source=actions/setup-node, method=repos.getCommit, resolvedAt=2026-08-17T23:37:14.238Z)
      - .github/workflows/release.yml:10 github/codeql-action/init@v3 -> 1111111111111111111111111111111111111111 (source=github/codeql-action/init, method=repos.getCommit, resolvedAt=2026-08-17T23:37:14.238Z)"
    `);

    expect(formatEvidenceMarkdown(evidence, fingerprint)).toMatchInlineSnapshot(`
      "# action-pinner report
      Generated at: 2026-08-17T23:37:14.238Z
      | File | Line | Action | Pinned SHA | Commit |
      |------|------|--------|------------|--------|
      | .github/workflows/ci.yml | 7 | actions/checkout@v4 | \`34e11487abcdef0123456789abcdef0123456789\` | [View](https://github.com/actions/checkout/commit/34e11487abcdef0123456789abcdef0123456789) |
      | .github/workflows/ci.yml | 8 | actions/setup-node@v4 | \`49933ea5fedcba9876543210fedcba9876543210\` | [View](https://github.com/actions/setup-node/commit/49933ea5fedcba9876543210fedcba9876543210) |
      | .github/workflows/release.yml | 10 | github/codeql-action/init@v3 | \`1111111111111111111111111111111111111111\` | [View](https://github.com/github/codeql-action/init/commit/1111111111111111111111111111111111111111) |

      ## Run fingerprint

      - Tool version: \`0.2.1\`
      - Config hash: \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`
      - Run fingerprint: \`bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\`"
    `);

    expect(formatEvidenceHtml(evidence, fingerprint)).toMatchInlineSnapshot(`
      "<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>action-pinner report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #1f2328; background: #ffffff; }
          h1, h2 { margin-bottom: 12px; }
          .meta { color: #59636e; margin-bottom: 24px; }
          table { border-collapse: collapse; width: 100%; margin-top: 16px; }
          th, td { border: 1px solid #d0d7de; padding: 10px 12px; text-align: left; vertical-align: top; }
          th { background: #f6f8fa; }
          code { font-family: Consolas, 'Courier New', monospace; }
          a { color: #0969da; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .empty { padding: 16px; border: 1px solid #d0d7de; background: #f6f8fa; }
          ul { padding-left: 20px; }
        </style>
      </head>
      <body>
        <header>
          <h1>action-pinner report</h1>
          <p class="meta">Generated at 2026-08-17T23:37:14.238Z</p>
        </header>
        <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Line</th>
            <th>Action</th>
            <th>Pinned SHA</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>.github/workflows/ci.yml</td>
            <td>7</td>
            <td><code>actions/checkout@v4</code></td>
            <td><code>34e11487abcdef0123456789abcdef0123456789</code></td>
            <td><a href="https://github.com/actions/checkout/commit/34e11487abcdef0123456789abcdef0123456789">View commit</a></td>
          </tr>
          <tr>
            <td>.github/workflows/ci.yml</td>
            <td>8</td>
            <td><code>actions/setup-node@v4</code></td>
            <td><code>49933ea5fedcba9876543210fedcba9876543210</code></td>
            <td><a href="https://github.com/actions/setup-node/commit/49933ea5fedcba9876543210fedcba9876543210">View commit</a></td>
          </tr>
          <tr>
            <td>.github/workflows/release.yml</td>
            <td>10</td>
            <td><code>github/codeql-action/init@v3</code></td>
            <td><code>1111111111111111111111111111111111111111</code></td>
            <td><a href="https://github.com/github/codeql-action/init/commit/1111111111111111111111111111111111111111">View commit</a></td>
          </tr>
        </tbody>
      </table>
        <section>
          <h2>Run fingerprint</h2>
          <ul>
            <li>Tool version: <code>0.2.1</code></li>
            <li>Config hash: <code>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code></li>
            <li>Run fingerprint: <code>bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</code></li>
          </ul>
        </section>
      </body>
      </html>"
    `);
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

function makeResolver(
  resolutions: Record<string, { sha: string; resolvedAt: string }>
): { resolve(reference: ActionReference): Promise<ResolutionResult> } {
  return {
    async resolve(reference) {
      const resolution = resolutions[`${reference.action}@${reference.ref}`];
      if (!resolution) {
        throw new Error(`Missing golden resolution for ${reference.raw}`);
      }
      return {
        original: reference.raw,
        sha: resolution.sha,
        comment: reference.ref ?? "",
        sourceRepo: reference.action,
        resolutionMethod: "repos.getCommit",
        resolvedAt: resolution.resolvedAt,
        githubApiUrl: "https://api.github.com"
      };
    }
  };
}

function makePatch(fileName: string, evidence: PinEvidence[]): FilePatch {
  return {
    filePath: resolve(process.cwd(), ".github", "workflows", fileName),
    originalContent: "",
    updatedContent: "",
    referencesUpdated: [],
    evidence
  };
}

function makeEvidence(
  fileName: string,
  line: number,
  originalRef: string,
  resolvedSha: string
): PinEvidence {
  const sourceRepo = originalRef.split("@")[0];
  return {
    filePath: resolve(process.cwd(), ".github", "workflows", fileName),
    line,
    originalRef,
    resolvedSha,
    sourceRepo,
    resolutionMethod: "repos.getCommit",
    resolvedAt: "2026-08-17T23:37:14.238Z",
    githubApiUrl: "https://api.github.com"
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
      branchPrefix: "chore/action-pinner",
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
      commentFormat: "{ref}",
      generateConfigSnippet: false
    }
  };
}
