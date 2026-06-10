import { describe, expect, it } from "vitest";
import { scanRepositories } from "../src/multi-repo-scanner.js";

describe("scanRepositories", () => {
  it("returns deterministic per-repo and aggregate results", async () => {
    const client = {
      repos: {
        get: async () => ({ data: { default_branch: "main" } }),
        getContent: async (params: { path: string }) => {
          if (params.path.endsWith("a.yml")) {
            return {
              data: {
                encoding: "base64",
                content: Buffer.from("jobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4").toString(
                  "base64"
                )
              }
            };
          }

          return {
            data: {
              encoding: "base64",
              content: Buffer.from("jobs:\n  build:\n    steps:\n      - uses: actions/cache@v4").toString(
                "base64"
              )
            }
          };
        }
      },
      git: {
        getTree: async () => ({
          data: {
            tree: [
              { type: "blob", path: ".github/workflows/b.yml" },
              { type: "blob", path: ".github/workflows/a.yml" }
            ]
          }
        })
      }
    };

    const result = await scanRepositories(
      ["acme/repo-b", "acme/repo-a"],
      {
        includePatterns: [".github/workflows/**/*.yml"],
        excludePatterns: [],
        includeActions: [],
        excludeActions: ["actions/cache"]
      },
      client as any
    );

    expect(result.repositories.map((entry) => entry.repository)).toEqual([
      "acme/repo-a",
      "acme/repo-b"
    ]);
    expect(result.summary.repositoriesScanned).toBe(2);
    expect(result.summary.unpinnedFound).toBe(2);
  });
});
