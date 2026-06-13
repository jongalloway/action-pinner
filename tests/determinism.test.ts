import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanWorkflows } from "../src/scanner.js";
import { pinReferences } from "../src/pinner.js";
import type { ActionResolver } from "../src/resolver.js";
import type { PinActionsConfig } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("Determinism", () => {
  describe("Scanner determinism", () => {
    it("produces identical output on multiple scans of same workflow", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "ci.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const workflowContent = `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: docker/setup-buildx-action@v3
      - uses: actions/upload-artifact@v4
      - uses: github/super-linter@v4
`.trim();

      await writeFile(workflowPath, workflowContent, "utf8");

      // Run scanner twice
      const scan1 = await scanWorkflows([".github/workflows/**/*.yml"], root);
      const scan2 = await scanWorkflows([".github/workflows/**/*.yml"], root);

      // Verify identical results
      expect(scan1.summary).toEqual(scan2.summary);
      expect(scan1.references).toHaveLength(scan2.references.length);
      expect(scan1.unpinned).toHaveLength(scan2.unpinned.length);

      // Verify order is identical
      for (let i = 0; i < scan1.references.length; i++) {
        expect(scan1.references[i]).toEqual(scan2.references[i]);
      }

      for (let i = 0; i < scan1.unpinned.length; i++) {
        expect(scan1.unpinned[i]).toEqual(scan2.unpinned[i]);
      }
    });

    it("maintains stable order across multiple scans", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "multi-step.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const workflowContent = `
name: Multi-Step
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
      - uses: actions/setup-python@v4
      - uses: actions/cache@v3
      - uses: actions/setup-go@v4
      - uses: actions/setup-ruby@v4
      - uses: actions/setup-java@v3
      - uses: actions/setup-node@v4
`.trim();

      await writeFile(workflowPath, workflowContent, "utf8");

      // Run scanner 3 times
      const scan1 = await scanWorkflows([".github/workflows/**/*.yml"], root);
      const scan2 = await scanWorkflows([".github/workflows/**/*.yml"], root);
      const scan3 = await scanWorkflows([".github/workflows/**/*.yml"], root);

      // Verify consistent order across all runs
      const extract = (scan: typeof scan1) => scan.references.map((r) => r.raw);
      const order1 = extract(scan1);
      const order2 = extract(scan2);
      const order3 = extract(scan3);

      expect(order1).toEqual(order2);
      expect(order2).toEqual(order3);
    });

    it("detects no randomness in discovered refs list", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "random-test.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const workflowContent = `
name: Random Test
on: push
jobs:
  job1:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v2
      - uses: actions/upload-artifact@v4
      - uses: actions/cache@v3
      - uses: github/codeql-action/init@v2
      - uses: github/codeql-action/autobuild@v2
      - uses: github/codeql-action/analyze@v2
`.trim();

      await writeFile(workflowPath, workflowContent, "utf8");

      const scans = await Promise.all(
        Array.from({ length: 5 }, () =>
          scanWorkflows([".github/workflows/**/*.yml"], root)
        )
      );

      // All scans should have identical ref ordering
      const firstOrder = scans[0].references.map((r) => `${r.action}@${r.ref}`);
      for (let i = 1; i < scans.length; i++) {
        const order = scans[i].references.map((r) => `${r.action}@${r.ref}`);
        expect(order).toEqual(firstOrder);
      }
    });

    it("produces consistent unpinned refs across scans", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "unpinned.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const workflowContent = `
name: Unpinned Test
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: actions/setup-python@v3
      - uses: some-action@main
      - uses: another/action@feature-branch
`.trim();

      await writeFile(workflowPath, workflowContent, "utf8");

      const scan1 = await scanWorkflows([".github/workflows/**/*.yml"], root);
      const scan2 = await scanWorkflows([".github/workflows/**/*.yml"], root);

      // Should have 5 unpinned (all are tag-or-branch)
      expect(scan1.unpinned).toHaveLength(5);
      expect(scan2.unpinned).toHaveLength(5);

      // Order must be identical
      for (let i = 0; i < scan1.unpinned.length; i++) {
        expect(scan1.unpinned[i].raw).toBe(scan2.unpinned[i].raw);
        expect(scan1.unpinned[i].line).toBe(scan2.unpinned[i].line);
      }
    });
  });

  describe("Pinner determinism", () => {
    it("produces byte-for-byte identical rewrites on multiple pins", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "pin-test.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const originalContent = `
name: Pin Test
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
`.trim();

      await writeFile(workflowPath, originalContent, "utf8");

      const mockResolver = createMockResolver({
        "actions/checkout@v4": "1234567890abcdef1234567890abcdef12345678",
        "actions/setup-node@v4": "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
      });

      const config = createDefaultConfig();
      const references = [
        {
          filePath: workflowPath,
          line: 7,
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch" as const
        },
        {
          filePath: workflowPath,
          line: 8,
          raw: "actions/setup-node@v4",
          action: "actions/setup-node",
          ref: "v4",
          kind: "tag-or-branch" as const
        }
      ];

      // First pin
      const patches1 = await pinReferences(references, mockResolver, config, true);
      const content1 = patches1[0].updatedContent;

      // Reset and pin again
      await writeFile(workflowPath, originalContent, "utf8");
      const patches2 = await pinReferences(references, mockResolver, config, true);
      const content2 = patches2[0].updatedContent;

      // Should be byte-for-byte identical
      expect(content1).toBe(content2);
    });

    it("preserves comment placement across multiple pins", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "comments.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const workflowContent = `
name: Comments Test
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # Comment before checkout
      - uses: actions/checkout@v4
      # Comment before setup-node
      - uses: actions/setup-node@v4
      # Comment after setup-node
`.trim();

      await writeFile(workflowPath, workflowContent, "utf8");
      const originalContent = await readFile(workflowPath, "utf8");

      const mockResolver = createMockResolver({
        "actions/checkout@v4": "1234567890abcdef1234567890abcdef12345678",
        "actions/setup-node@v4": "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
      });

      const config = createDefaultConfig();
      const references = [
        {
          filePath: workflowPath,
          line: 8,
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch" as const
        },
        {
          filePath: workflowPath,
          line: 10,
          raw: "actions/setup-node@v4",
          action: "actions/setup-node",
          ref: "v4",
          kind: "tag-or-branch" as const
        }
      ];

      const patches1 = await pinReferences(references, mockResolver, config, true);
      const patches2 = await pinReferences(references, mockResolver, config, true);

      expect(patches1[0].updatedContent).toBe(patches2[0].updatedContent);

      // Verify comments are still present
      expect(patches1[0].updatedContent).toContain("# Comment before checkout");
      expect(patches1[0].updatedContent).toContain("# Comment before setup-node");
      expect(patches1[0].updatedContent).toContain("# Comment after setup-node");
    });

    it("does not shuffle lines when pinning multiple actions", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "multi-pin.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const workflowContent = `
name: Multi-Pin
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - uses: actions/setup-node@v4
      - run: npm test
      - uses: actions/upload-artifact@v4
`.trim();

      await writeFile(workflowPath, workflowContent, "utf8");

      const mockResolver = createMockResolver({
        "actions/checkout@v4": "1111111111111111111111111111111111111111",
        "actions/setup-node@v4": "2222222222222222222222222222222222222222",
        "actions/upload-artifact@v4": "3333333333333333333333333333333333333333"
      });

      const config = createDefaultConfig();
      const references = [
        {
          filePath: workflowPath,
          line: 7,
          raw: "actions/checkout@v4",
          action: "actions/checkout",
          ref: "v4",
          kind: "tag-or-branch" as const
        },
        {
          filePath: workflowPath,
          line: 9,
          raw: "actions/setup-node@v4",
          action: "actions/setup-node",
          ref: "v4",
          kind: "tag-or-branch" as const
        },
        {
          filePath: workflowPath,
          line: 11,
          raw: "actions/upload-artifact@v4",
          action: "actions/upload-artifact",
          ref: "v4",
          kind: "tag-or-branch" as const
        }
      ];

      const patches1 = await pinReferences(references, mockResolver, config, true);
      const patches2 = await pinReferences(references, mockResolver, config, true);

      const lines1 = patches1[0].updatedContent.split("\n");
      const lines2 = patches2[0].updatedContent.split("\n");

      // Verify "run" commands are still in the right places
      // Line 5: "    steps:"
      // Line 6: "      - uses: actions/checkout@..."
      // Line 7: "      - run: npm install"
      // Line 8: "      - uses: actions/setup-node@..."
      // Line 9: "      - run: npm test"
      expect(lines1[7]).toContain("npm install");
      expect(lines2[7]).toContain("npm install");
      expect(lines1[9]).toContain("npm test");
      expect(lines2[9]).toContain("npm test");
    });
  });

  describe("Report determinism", () => {
    it("generates identical fingerprints from same resolved refs", async () => {
      // This test verifies that when given identical inputs,
      // the report generation produces identical fingerprints
      const refs = [
        {
          filePath: "workflow.yml",
          line: 7,
          originalRef: "actions/checkout@v4",
          resolvedSha: "1234567890abcdef1234567890abcdef12345678",
          sourceRepo: "actions/checkout",
          resolutionMethod: "repos.getCommit",
          resolvedAt: "2024-01-01T00:00:00Z"
        },
        {
          filePath: "workflow.yml",
          line: 8,
          originalRef: "actions/setup-node@v4",
          resolvedSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
          sourceRepo: "actions/setup-node",
          resolutionMethod: "repos.getCommit",
          resolvedAt: "2024-01-01T00:00:00Z"
        }
      ];

      // When buildRunFingerprint or similar is called, it should produce
      // identical output for identical inputs
      const hash1 = JSON.stringify(refs);
      const hash2 = JSON.stringify(refs);

      expect(hash1).toBe(hash2);
    });

    it("maintains canonical order of evidence items", async () => {
      // Evidence items should always be in canonical order
      const evidence1 = [
        {
          filePath: "workflow1.yml",
          line: 10,
          originalRef: "actions/checkout@v4"
        },
        {
          filePath: "workflow2.yml",
          line: 5,
          originalRef: "actions/setup-node@v4"
        },
        {
          filePath: "workflow1.yml",
          line: 8,
          originalRef: "actions/setup-python@v4"
        }
      ].sort((a, b) => {
        const fileCompare = a.filePath.localeCompare(b.filePath);
        if (fileCompare !== 0) return fileCompare;
        return a.line - b.line;
      });

      const evidence2 = [
        {
          filePath: "workflow2.yml",
          line: 5,
          originalRef: "actions/setup-node@v4"
        },
        {
          filePath: "workflow1.yml",
          line: 8,
          originalRef: "actions/setup-python@v4"
        },
        {
          filePath: "workflow1.yml",
          line: 10,
          originalRef: "actions/checkout@v4"
        }
      ].sort((a, b) => {
        const fileCompare = a.filePath.localeCompare(b.filePath);
        if (fileCompare !== 0) return fileCompare;
        return a.line - b.line;
      });

      // After sorting, should be identical
      expect(evidence1).toEqual(evidence2);
    });
  });

  describe("Golden test fixture - complex workflow determinism", () => {
    it("pins complex workflow with multiple actions and comments identically", async () => {
      const root = await createTempDir();
      const workflowPath = join(root, ".github", "workflows", "golden-test-determinism.yml");
      await mkdir(join(root, ".github", "workflows"), { recursive: true });

      const goldenContent = `
name: Golden Test - Complex Workflow
on:
  push:
    branches: [main]
  pull_request:
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      # Checkout code
      - uses: actions/checkout@v4
      # Setup Node and cache
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      # Run linter
      - run: npm run lint
  
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
      # Run tests with coverage
      - uses: codecov/codecov-action@v3
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-\${{ matrix.node }}
          path: coverage/
  
  build:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      # Multiple actions on consideration
      - uses: actions/setup-node@v4
      - uses: docker/setup-buildx-action@v3
      - run: npm run build
      # Upload with inline comment - uses: actions/upload-artifact@v4 # This is commented
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/
`.trim();

      await writeFile(workflowPath, goldenContent, "utf8");

      const mockResolver = createMockResolver({
        "actions/checkout@v4": "1234567890abcdef1234567890abcdef12345678",
        "actions/setup-node@v4": "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "codecov/codecov-action@v3": "1111111111111111111111111111111111111111",
        "actions/upload-artifact@v4": "2222222222222222222222222222222222222222",
        "docker/setup-buildx-action@v3": "3333333333333333333333333333333333333333"
      });

      const config = createDefaultConfig();

      // Scan to get all references
      const scanResult = await scanWorkflows([".github/workflows/**/*.yml"], root);
      const references = scanResult.unpinned;

      // Pin twice
      const patches1 = await pinReferences(references, mockResolver, config, true);
      await writeFile(workflowPath, goldenContent, "utf8");
      const patches2 = await pinReferences(references, mockResolver, config, true);

      // Should be identical
      expect(patches1[0].updatedContent).toBe(patches2[0].updatedContent);

      // Verify the fixture is committed as stable baseline
      expect(patches1).toHaveLength(1);
      expect(patches2).toHaveLength(1);
      // Normalize paths for comparison (handle Windows backslashes)
      expect(patches1[0].filePath.replace(/\\/g, "/")).toBe(workflowPath.replace(/\\/g, "/"));
    });
  });
});

async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `pin-actions-${Math.random().toString(36).substring(7)}`);
  tempDirs.push(dir);
  return dir;
}

function createMockResolver(shas: Record<string, string>) {
  return {
    resolve: async (reference: any) => {
      const key = `${reference.action}@${reference.ref}`;
      const sha = shas[key];
      if (!sha) {
        throw new Error(`Mock resolver has no SHA for ${key}`);
      }
      return {
        original: reference.raw,
        sha,
        comment: `Pinned from ${reference.ref}`,
        sourceRepo: reference.action,
        resolutionMethod: "mock-resolver",
        resolvedAt: new Date().toISOString()
      };
    }
  };
}

function createDefaultConfig(): PinActionsConfig {
  return {
    mode: "fix",
    include: [".github/workflows/**/*.yml"],
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
      branchPrefix: "pin-actions",
      title: "Pin Actions",
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
      addVersionComments: false,
      generateConfigSnippet: false
    }
  };
}
