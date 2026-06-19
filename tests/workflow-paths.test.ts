import { describe, expect, it } from "vitest";
import {
  resolveWorkflowPatterns,
  normalizeWorkflowPattern,
  toDisplayPath,
  DEFAULT_WORKFLOW_PATTERNS
} from "../src/workflow-paths.js";

describe("resolveWorkflowPatterns", () => {
  it("returns default patterns when given no input", () => {
    const result = resolveWorkflowPatterns();
    expect(result).toEqual([
      ".github/workflows/**/*.yml",
      ".github/workflows/**/*.yaml"
    ]);
  });

  it("returns default patterns for empty array", () => {
    const result = resolveWorkflowPatterns([]);
    expect(result).toEqual([
      ".github/workflows/**/*.yml",
      ".github/workflows/**/*.yaml"
    ]);
  });

  it("passes through explicit glob patterns", () => {
    const result = resolveWorkflowPatterns(["src/**/*.yml"]);
    expect(result).toEqual(["src/**/*.yml"]);
  });

  it("passes through explicit .yml file paths", () => {
    const result = resolveWorkflowPatterns([".github/workflows/ci.yml"]);
    expect(result).toEqual([".github/workflows/ci.yml"]);
  });

  it("passes through explicit .yaml file paths", () => {
    const result = resolveWorkflowPatterns(["workflows/deploy.yaml"]);
    expect(result).toEqual(["workflows/deploy.yaml"]);
  });

  it("expands directory inputs to **/*.yml and **/*.yaml", () => {
    const result = resolveWorkflowPatterns([".github/workflows"]);
    expect(result).toEqual([
      ".github/workflows/**/*.yml",
      ".github/workflows/**/*.yaml"
    ]);
  });

  it("strips trailing slashes before expanding directories", () => {
    const result = resolveWorkflowPatterns(["workflows/"]);
    expect(result).toEqual(["workflows/**/*.yml", "workflows/**/*.yaml"]);
  });

  it("strips multiple trailing slashes", () => {
    const result = resolveWorkflowPatterns(["workflows///"]);
    expect(result).toEqual(["workflows/**/*.yml", "workflows/**/*.yaml"]);
  });

  it("normalizes backslashes in inputs", () => {
    const result = resolveWorkflowPatterns([".github\\workflows\\ci.yml"]);
    expect(result).toEqual([".github/workflows/ci.yml"]);
  });

  it("handles mixed inputs (files, globs, directories)", () => {
    const result = resolveWorkflowPatterns([
      ".github/workflows/ci.yml",
      "custom/**/*.yaml",
      "other-workflows"
    ]);
    expect(result).toEqual([
      ".github/workflows/ci.yml",
      "custom/**/*.yaml",
      "other-workflows/**/*.yml",
      "other-workflows/**/*.yaml"
    ]);
  });

  it("recognizes patterns with ? as globs", () => {
    const result = resolveWorkflowPatterns(["workflows/ci?.yml"]);
    expect(result).toEqual(["workflows/ci?.yml"]);
  });

  it("recognizes patterns with [ as globs", () => {
    const result = resolveWorkflowPatterns(["workflows/[ab].yml"]);
    expect(result).toEqual(["workflows/[ab].yml"]);
  });

  it("recognizes patterns with { as globs", () => {
    const result = resolveWorkflowPatterns(["workflows/{a,b}.yml"]);
    expect(result).toEqual(["workflows/{a,b}.yml"]);
  });
});

describe("normalizeWorkflowPattern", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(normalizeWorkflowPattern("a\\b\\c")).toBe("a/b/c");
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizeWorkflowPattern("a/b/c")).toBe("a/b/c");
  });

  it("handles mixed separators", () => {
    expect(normalizeWorkflowPattern("a\\b/c\\d")).toBe("a/b/c/d");
  });
});

describe("toDisplayPath", () => {
  it("returns a relative forward-slash path from cwd", () => {
    const result = toDisplayPath("/project/src/file.ts", "/project");
    expect(result).toBe("src/file.ts");
  });

  it("handles same directory", () => {
    const result = toDisplayPath("/project/file.ts", "/project");
    expect(result).toBe("file.ts");
  });
});

describe("DEFAULT_WORKFLOW_PATTERNS", () => {
  it("includes yml and yaml patterns", () => {
    expect(DEFAULT_WORKFLOW_PATTERNS).toContain(".github/workflows/**/*.yml");
    expect(DEFAULT_WORKFLOW_PATTERNS).toContain(".github/workflows/**/*.yaml");
  });

  it("has exactly 2 default patterns", () => {
    expect(DEFAULT_WORKFLOW_PATTERNS).toHaveLength(2);
  });
});
