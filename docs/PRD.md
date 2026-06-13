# Product Requirements Document (PRD)
**Product:** `pin-actions` (working name)  
**Type:** Open-source CLI + GitHub Action + optional GitHub App  
**Version:** v1.0 PRD  
**Date:** 2026-06-09

## 1. Summary

`pin-actions` is a modern, actively maintained replacement for the unmaintained `pin-github-action` project. It scans repositories for unpinned GitHub Actions, resolves tags/branches to immutable commit SHAs using modern GitHub APIs, rewrites workflow files safely, and creates pull requests with pinned updates.

The tool targets both one-time migration (initial pinning) and ongoing governance (consistency and optional CI enforcement), with support for single-repo, multi-repo, and org-wide operation.

---

## 2. Motivation / Problem Statement

Organizations increasingly require immutable GitHub Actions references for supply-chain security.

1. GitHub strongly recommends pinning actions to commit SHAs.  
2. Dependabot does not auto-pin unpinned actions.  
3. `pin-github-action` is unmaintained and predates modern APIs/tooling (Octokit, GraphQL usage patterns, Node 20+, current security expectations).  

Teams need a reliable, maintained utility that can:
- perform initial bulk pinning,
- preserve readability and Dependabot compatibility,
- automate PR creation,
- and optionally enforce pinning in CI.

---

## 3. Goals

1. Detect unpinned `uses:` references in GitHub workflow YAML files.
2. Resolve tags/branches to commit SHAs via modern GitHub APIs (REST v3 + GraphQL v4 via Octokit).
3. Rewrite workflows to SHA-pinned references while preserving file formatting as much as possible.
4. Add version comments (`# vX.Y.Z`) for Dependabot compatibility/readability.
5. Automatically create structured pull requests with changes.
6. Support single repo, multi-repo, and org-wide scanning.
7. Provide optional CI enforcement mode (fail when unpinned actions are detected).
8. Offer configurable behavior via `.pin-actions.json`.
9. Run as both CLI and GitHub Action; optionally as GitHub App for autonomous operation.

---

## 4. Non-Goals (v1)

1. Replacing Dependabot for updates/version bumping.
2. Full policy engine beyond pinning rules (broad compliance framework).
3. Automatically pinning local actions (`./path`) or Docker references outside defined scope.
4. Automatic remediation of every YAML style edge case without fallback modes.
5. Secret scanning or general SAST functionality.

---

## 5. Users / Personas

1. **Platform Engineer / Security Engineer**: wants org-wide baseline pinning and policy enforcement.  
2. **Repository Maintainer**: wants one-command pinning and auto-PRs.  
3. **DevOps/SRE**: wants CI gate to prevent regressions (new unpinned actions).  
4. **Open-source Maintainer**: wants low-friction local/CI usage without GitHub App setup.

---

## 6. User Stories

1. As a repo maintainer, I can run `pin-actions scan` and see all unpinned actions.  
2. As a maintainer, I can run `pin-actions fix` and get workflows rewritten to SHA pins with readable version comments.  
3. As a maintainer, I can run `pin-actions pr` to automatically commit changes and open a PR.  
4. As a security engineer, I can run org-wide scans and receive a report of non-compliant repos.  
5. As a CI owner, I can run `pin-actions enforce` and fail builds if unpinned actions exist.  
6. As an admin, I can define organization defaults in `.pin-actions.json`.  
7. As a Dependabot user, I can keep `# vX.Y.Z` comments so future updates remain understandable and manageable.

---

## 7. Functional Requirements

### FR1: Repository Scanner
- Detect workflow files under `.github/workflows/**/*.yml|yaml`.
- Parse all `uses:` entries in job/step contexts.
- Classify each reference: already pinned SHA, tag, branch, local action, Docker image, invalid.
- Output machine-readable and human-readable scan results.

### FR2: Tag/Branch → SHA Resolver
- Resolve refs using Octokit with:
  - REST v3 endpoints (`repos.getCommit`, `git.getRef`, etc.) as primary path.
  - GraphQL v4 for efficient batched metadata where beneficial.
- Handle rate limits, retries, and not-found/private repo errors.
- Cache resolutions during a run and optionally between runs.

### FR3: Auto-Pinning Engine
- Rewrite `owner/repo@ref` → `owner/repo@<40-char-sha> # <original-ref-or-version>`.
- Preserve YAML formatting and ordering to minimize noisy diffs.
- Preserve comments where possible.
- Support dry-run mode with diff preview.

### FR4: PR Generator
- Create branch, commit updated workflows, and open PR.
- PR title/body templates include:
  - summary of pinned actions,
  - before/after examples,
  - guidance for maintainers.
- Optional labels, assignees, reviewers via config.

### FR5: Multi-Repo / Org-Wide Mode
- Enumerate repos in org/user scope with filters:
  - include/exclude patterns,
  - archived/fork/private toggles,
  - default branch only.
- Produce consolidated report and per-repo action status.
- Optionally open PRs in eligible repositories.

### FR6: Optional CI Enforcement Mode
- Read workflows and fail with non-zero exit code if unpinned actions found.
- Configurable severity/allowlists.
- Supports GitHub Action usage for policy checks in PR pipelines.

### FR7: Configuration Support (`.pin-actions.json`)
- Centralize behavior (resolver options, exclusions, PR settings, enforcement).
- Support local config + CLI flags override precedence.
- Validate schema and provide clear error messages.

### FR8: Dependabot Compatibility
- Add/retain trailing comments such as `# v4.2.1` to preserve human-readable source ref.
- Optional helper mode to generate or augment Dependabot config snippets for actions updates.

### FR9: Execution Modes
- **CLI mode** for local/CI execution.
- **GitHub Action mode** for repository workflows.
- **Optional GitHub App mode** for scheduled autonomous scanning and PR creation across repos.

---

## 8. Architecture Overview

```mermaid
flowchart LR
  A[Input: Repo(s) + Config] --> B[Workflow Scanner]
  B --> C[Reference Classifier]
  C --> D[Resolver Service<br/>Octokit REST/GraphQL]
  D --> E[Pinning/Rewriter Engine]
  E --> F[Diff + Report Generator]
  F --> G[PR Service]
  F --> H[CI Enforcement Output]
  D --> I[Resolution Cache]
  A --> J[Config Loader/Validator]
  J --> B
  J --> D
  J --> E
  J --> G
```

### Core technical stack
- **Runtime:** Node.js 20+  
- **GitHub API:** Octokit (REST + GraphQL clients)  
- **YAML processing:** `yaml` (preferred) or `js-yaml`  
- **Git operations:** `simple-git` or `isomorphic-git`  
- **CLI framework:** modern Node CLI tooling (e.g., Commander/yargs)  
- **Validation:** JSON schema for `.pin-actions.json`

---

## 9. Component Breakdown

1. **Config Module**
   - Loads `.pin-actions.json`, validates schema, merges CLI overrides.

2. **Scanner Module**
   - Discovers workflow files and extracts `uses:` references with file/line metadata.

3. **Resolver Module**
   - Resolves action refs to immutable SHAs using Octokit.
   - Includes rate-limit handling, retries, caching, auth handling.

4. **Rewrite Engine**
   - Updates YAML while preserving formatting/comments where possible.
   - Injects version comments for Dependabot/readability.

5. **Diff & Reporting Module**
   - Human summary + JSON output for automation.
   - Tracks changed files/actions and unresolved refs.

6. **Git/PR Module**
   - Branch creation, commits, push, PR creation.
   - Template-driven PR body and metadata controls.

7. **Execution Adapters**
   - CLI adapter.
   - GitHub Action adapter (inputs/outputs).
   - Optional GitHub App adapter (webhook/scheduled jobs).

8. **Policy/Enforcement Module**
   - CI validation logic and exit codes.
   - Allowlists/exceptions support.

---

## 10. Configuration (`.pin-actions.json`) – Initial Schema

```json
{
  "$schema": "https://example.org/pin-actions.schema.json",
  "mode": "fix",
  "include": ["**/.github/workflows/*.yml", "**/.github/workflows/*.yaml"],
  "excludeRepos": ["experimental-*"],
  "excludeActions": ["actions/cache"],
  "org": {
    "name": "my-org",
    "includePrivate": true,
    "includeArchived": false
  },
  "pr": {
    "create": true,
    "branchPrefix": "chore/pin-actions",
    "title": "Pin GitHub Actions to commit SHAs",
    "labels": ["security", "dependencies"]
  },
  "enforcement": {
    "enabled": false,
    "failOnUnpinned": true
  },
  "dependabot": {
    "addVersionComments": true,
    "generateConfigSnippet": false
  }
}
```

---

## 11. Acceptance Criteria

| Area | Acceptance Criteria |
|---|---|
| Scanner | Finds unpinned actions in standard workflow paths with file/line output. |
| Resolver | Correctly resolves tag/branch refs to SHAs using Octokit with robust error handling. |
| Rewriter | Produces valid YAML, preserves structure/formatting, and adds `# vX.Y.Z` comments when enabled. |
| PR creation | Creates branch/commit/PR with structured body and list of modified workflows/actions. |
| Multi-repo mode | Scans configured org/repo set and emits per-repo + aggregate results. |
| CI enforcement | Returns non-zero exit code when policy violations exist; zero when compliant. |
| Config | `.pin-actions.json` is schema-validated; CLI flags override file settings predictably. |
| Action mode | Can run in GitHub Actions with token-based auth and clear outputs. |
| Reliability | Handles API rate limits/retries and reports unresolved refs without silent failure. |
| Security | Uses least-privilege token scopes guidance and never logs secrets. |

---

## 12. Non-Functional Requirements

1. **Security:** token-safe logs, least-privilege guidance, deterministic pinning behavior.  
2. **Performance:** scan + resolve completes quickly for typical repos; batched API requests and caching.  
3. **Reliability:** resilient retries/backoff; partial failures surfaced clearly.  
4. **Maintainability:** modular architecture, typed codebase, test coverage for resolver/rewriter edge cases.  
5. **Compatibility:** Node.js 20+, GitHub.com and GHES compatibility targets documented.

---

## 13. Delivery Phases

1. **MVP (v1.0):** CLI + Action mode, scan/fix/enforce, PR creation, config support, Dependabot comments.  
2. **v1.1:** Multi-repo/org mode hardening, reporting improvements, optional Dependabot snippet generation.  
3. **v1.2+:** Optional GitHub App mode, richer policy controls, scaling improvements.

---

## 14. Stretch Features (Optional)

1. **Provenance verification** (e.g., release artifact/provenance checks where supported).  
2. **SBOM/SARIF output** for governance and security pipeline integration.  
3. **Slack/Teams notifications** for scan/enforcement/PR events.  
4. **Plugin hooks** (pre-resolve/post-rewrite/pre-pr) for custom enterprise workflows.

---

## 15. Risks & Mitigations

1. **YAML round-trip fidelity risk** → choose parser with CST/comment preservation; add golden-file tests.  
2. **API rate limiting at org scale** → caching, batching, backoff, and concurrency controls.  
3. **False positives/unsupported refs** → explicit classification + actionable unresolved report.  
4. **Permission variability** → clear token scope docs; graceful fallback when PR creation is not allowed.  

This PRD defines a complete, modern baseline for replacing `pin-github-action` with a secure, maintainable, and automation-friendly open-source tool.
