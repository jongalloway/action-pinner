import { describe, expect, it, vi } from "vitest";
import { buildPrBody, publishPullRequest } from "../src/pr.js";
import type { FilePatch, PinActionsConfig } from "../src/types.js";

describe("pr helpers", () => {
  it("renders a customizable PR body", () => {
    const body = buildPrBody(
      [
        {
          filePath: ".github/workflows/ci.yml",
          originalContent: "",
          updatedContent: "",
          evidence: [
            {
              filePath: ".github/workflows/ci.yml",
              line: 4,
              originalRef: "actions/checkout@v4",
              resolvedSha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc",
              sourceRepo: "actions/checkout",
              resolutionMethod: "repos.getCommit",
              resolvedAt: "2026-06-09T19:00:00.000Z"
            }
          ],
          referencesUpdated: [
            {
              filePath: ".github/workflows/ci.yml",
              line: 4,
              raw: "actions/checkout@v4",
              action: "actions/checkout",
              ref: "v4",
              kind: "tag-or-branch"
            }
          ]
        }
      ],
      [
        "Title: {{summary}}",
        "Files: {{fileCount}}",
        "Refs: {{referenceCount}}",
        "Branch: {{branch}}"
      ].join("\n"),
      {
        branch: "chore/pin-actions-123",
        baseBranch: "main",
        commitMessage: "chore: pin GitHub Actions to commit SHAs"
      }
    );

    expect(body).toContain("Pinned 1 action reference(s) across 1 file(s).");
    expect(body).toContain("Files: 1");
    expect(body).toContain("Refs: 1");
    expect(body).toContain("Branch: chore/pin-actions-123");
  });

  it("creates a pull request with optional metadata", async () => {
    const git = {
      raw: vi.fn().mockResolvedValue(undefined),
      getRemotes: vi.fn()
    };

    const client = {
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: { number: 42, html_url: "https://github.com/acme/pin-actions/pull/42" }
        }),
        requestReviewers: vi.fn().mockResolvedValue(undefined)
      },
      issues: {
        addLabels: vi.fn().mockResolvedValue(undefined),
        addAssignees: vi.fn().mockResolvedValue(undefined)
      }
    };

    const result = await publishPullRequest({
      config: makeConfig(),
      patches: makePatches(),
      branch: "chore/pin-actions-123",
      baseBranch: "main",
      token: "token",
      git,
      client,
      repository: {
        owner: "acme",
        repo: "pin-actions"
      }
    });

    expect(result).toEqual({
      number: 42,
      htmlUrl: "https://github.com/acme/pin-actions/pull/42"
    });
    expect(git.raw).toHaveBeenCalledWith(["push", "-u", "origin", "chore/pin-actions-123"]);
    expect(client.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "pin-actions",
        title: "Pin GitHub Actions to commit SHAs",
        head: "chore/pin-actions-123",
        base: "main"
      })
    );
    const pullCreateBody = vi.mocked(client.pulls.create).mock.calls[0]?.[0].body ?? "";
    expect(pullCreateBody).toContain("## Evidence");
    expect(pullCreateBody).toContain("Run fingerprint");
    expect(client.issues.addLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "pin-actions",
      issue_number: 42,
      labels: ["security", "dependencies"]
    });
    expect(client.issues.addAssignees).toHaveBeenCalledWith({
      owner: "acme",
      repo: "pin-actions",
      issue_number: 42,
      assignees: ["octocat"]
    });
    expect(client.pulls.requestReviewers).toHaveBeenCalledWith({
      owner: "acme",
      repo: "pin-actions",
      pull_number: 42,
      reviewers: ["hubot"]
    });
  });
});

function makeConfig(): PinActionsConfig {
  return {
    mode: "pr",
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
      create: true,
      branchPrefix: "chore/pin-actions",
      title: "Pin GitHub Actions to commit SHAs",
      labels: ["security", "dependencies"],
      reviewers: ["hubot"],
      assignees: ["octocat"]
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

function makePatches(): FilePatch[] {
  return [
    {
      filePath: ".github/workflows/ci.yml",
      originalContent: "jobs: {}",
      updatedContent: "jobs: {}",
      evidence: [
        {
          filePath: ".github/workflows/ci.yml",
          line: 4,
          originalRef: "actions/checkout@v4",
          resolvedSha: "fedcfedcfedcfedcfedcfedcfedcfedcfedcfedc",
          sourceRepo: "actions/checkout",
          resolutionMethod: "repos.getCommit",
          resolvedAt: "2026-06-09T19:00:00.000Z"
        }
      ],
      referencesUpdated: [
        {
          filePath: ".github/workflows/ci.yml",
          line: 4,
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch"
        }
      ]
    }
  ];
}
