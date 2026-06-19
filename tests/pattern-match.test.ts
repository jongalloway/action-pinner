import { describe, expect, it } from "vitest";
import { matchesPattern, matchesAnyPattern } from "../src/pattern-match.js";

describe("matchesPattern", () => {
  describe("single wildcard (*)", () => {
    it("matches any segment characters", () => {
      expect(matchesPattern("actions/checkout", "actions/*")).toBe(true);
    });

    it("does not match across path separators", () => {
      expect(matchesPattern("actions/cache/restore", "actions/*")).toBe(false);
    });

    it("matches zero-length segment (glob * is [^/]*)", () => {
      expect(matchesPattern("actions/", "actions/*")).toBe(true);
      expect(matchesPattern("actions/x", "actions/*")).toBe(true);
    });
  });

  describe("globstar (**)", () => {
    it("matches nested paths with **/", () => {
      expect(matchesPattern("a/b/c/file.yml", "**/file.yml")).toBe(true);
    });

    it("matches zero intermediate directories with **/", () => {
      expect(matchesPattern("file.yml", "**/file.yml")).toBe(true);
    });

    it("matches everything with bare **", () => {
      expect(matchesPattern("deeply/nested/path", "**")).toBe(true);
    });
  });

  describe("question mark (?)", () => {
    it("matches exactly one character", () => {
      expect(matchesPattern("actions/v4", "actions/v?")).toBe(true);
    });

    it("does not match path separators", () => {
      expect(matchesPattern("a/b", "a?b")).toBe(false);
    });

    it("does not match empty", () => {
      expect(matchesPattern("actions/v", "actions/v?")).toBe(false);
    });
  });

  describe("brace expansion ({a,b})", () => {
    it("matches any of the alternatives", () => {
      expect(matchesPattern("file.yml", "file.{yml,yaml}")).toBe(true);
      expect(matchesPattern("file.yaml", "file.{yml,yaml}")).toBe(true);
    });

    it("rejects non-matching alternatives", () => {
      expect(matchesPattern("file.json", "file.{yml,yaml}")).toBe(false);
    });
  });

  describe("case sensitivity", () => {
    it("is case-insensitive by default", () => {
      expect(matchesPattern("Actions/Checkout", "actions/*")).toBe(true);
    });

    it("respects caseInsensitive: false", () => {
      expect(
        matchesPattern("Actions/Checkout", "actions/*", { caseInsensitive: false })
      ).toBe(false);
    });
  });

  describe("backslash normalization", () => {
    it("normalizes backslashes in patterns to forward slashes", () => {
      expect(matchesPattern("actions/checkout", "actions\\checkout")).toBe(true);
    });
  });

  describe("special regex characters", () => {
    it("escapes dots in patterns", () => {
      expect(matchesPattern("file.yml", "file.yml")).toBe(true);
      expect(matchesPattern("fileXyml", "file.yml")).toBe(false);
    });

    it("escapes parentheses and pipes", () => {
      expect(matchesPattern("foo(bar)", "foo(bar)")).toBe(true);
      expect(matchesPattern("foo|bar", "foo|bar")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("exact match with no glob characters", () => {
      expect(matchesPattern("actions/checkout", "actions/checkout")).toBe(true);
    });

    it("empty pattern matches only empty string", () => {
      expect(matchesPattern("", "")).toBe(true);
      expect(matchesPattern("something", "")).toBe(false);
    });

    it("pattern must match the full string (anchored)", () => {
      expect(matchesPattern("prefix/actions/checkout", "actions/*")).toBe(false);
      expect(matchesPattern("actions/checkout/suffix", "actions/*")).toBe(false);
    });
  });
});

describe("matchesAnyPattern", () => {
  it("returns true if any pattern matches", () => {
    expect(
      matchesAnyPattern("actions/checkout", ["other/*", "actions/*"])
    ).toBe(true);
  });

  it("returns false if no patterns match", () => {
    expect(
      matchesAnyPattern("custom/action", ["actions/*", "github/*"])
    ).toBe(false);
  });

  it("returns false for empty patterns array", () => {
    expect(matchesAnyPattern("anything", [])).toBe(false);
  });

  it("passes options through to each pattern", () => {
    expect(
      matchesAnyPattern("Actions/Checkout", ["actions/*"], { caseInsensitive: false })
    ).toBe(false);
  });
});
