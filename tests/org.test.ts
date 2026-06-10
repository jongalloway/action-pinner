import { describe, expect, it } from "vitest";
import { filterRepositories } from "../src/org.js";

describe("filterRepositories", () => {
  it("applies include patterns before exclude patterns with deterministic ordering", () => {
    const repositories = [
      "Acme/Platform-Core",
      "acme/platform-archive",
      "acme/service-b",
      "acme/service-a"
    ];

    const filtered = filterRepositories(repositories, {
      includePatterns: ["platform-*", "service-*"],
      excludePatterns: ["*-archive"]
    });

    expect(filtered).toEqual([
      "Acme/Platform-Core",
      "acme/service-a",
      "acme/service-b"
    ]);
  });

  it("supports repo-name only patterns", () => {
    const filtered = filterRepositories(
      ["acme/security-tools", "acme/platform", "other/acme-platform"],
      {
        includePatterns: ["platform", "security-*"]
      }
    );

    expect(filtered).toEqual(["acme/platform", "acme/security-tools"]);
  });
});
