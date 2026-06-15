# action-pinner

[![npm version](https://img.shields.io/npm/v/action-pinner.svg)](https://www.npmjs.com/package/action-pinner)
[![CI](https://github.com/jongalloway/action-pinner/actions/workflows/ci.yml/badge.svg)](https://github.com/jongalloway/action-pinner/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/action-pinner.svg)](./LICENSE)

Pin GitHub Actions refs like `@v4` or `@main` to immutable commit SHAs so your workflows are safer to review, harder to tamper with, and easier to reproduce. `action-pinner` scans workflow files, rewrites refs in place, enforces policy in CI, and can open a pull request with the changes.

## Quick Start

No install needed — just run:

```bash
npx action-pinner scan                  # find unpinned refs
npx action-pinner fix                   # pin them to SHAs
npx action-pinner fix --dry-run         # preview without writing
```

Or install globally:

```bash
npm install -g action-pinner
action-pinner scan
```

> **Requires:** Node.js 20+

## Why Pin Actions?

- **Tags can move.** `@v4` and `@main` are mutable; a SHA is not.
- **Supply chain risk goes down.** Pinning limits surprise changes from compromised or retagged releases.
- **Builds become reproducible.** The same workflow definition resolves to the same code every time.
- **Audits get easier.** SHA-based refs and exception metadata leave a clearer review trail.

## CLI Commands

All commands work with `npx action-pinner <command>` or just `action-pinner <command>` if installed globally.

### `scan`

Find unpinned `uses:` refs without modifying files.

```bash
action-pinner scan
action-pinner scan --path ".github/workflows"
action-pinner scan --exclude-path ".github/workflows/legacy/**"
action-pinner scan --include-action "actions/*" --exclude-action "actions/cache"
action-pinner scan --github-org octo-org --include-repo "platform-*" --exclude-repo "*-archive"
action-pinner scan --repo octo-org/service-a octo-org/service-b --json
```

Flags:

- `--config <path>`: config file path (default: `.action-pinner.json`)
- `--path <path...>`: workflow file, directory, or glob to scan
- `--exclude-path <path...>`: workflow file, directory, or glob to skip
- `--include-action <pattern...>`: only scan matching actions
- `--exclude-action <pattern...>`: skip matching actions
- `--repo <owner/repo...>`: explicit multi-repo targets
- `--github-org <org>`: enumerate repositories from an organization
- `--include-repo <pattern...>` / `--exclude-repo <pattern...>`: repo filters for org or explicit targets
- `--json`: emit machine-readable JSON
- `--token <token>`: GitHub token override
- `--github-api-url <url>`: GitHub API base URL, including GHES
- `--use-netrc`: read credentials from `.netrc` / `_netrc`

### `fix`

Resolve mutable refs to SHAs and update workflow files in place.

```bash
action-pinner fix
action-pinner fix --dry-run
action-pinner fix --path ".github/workflows/release.yml"
action-pinner fix --continue-on-error --fail-on-ambiguous
action-pinner fix --comment-format "pin@{ref}"
```

Flags:

- `--dry-run`: preview changes without writing files
- All `scan` flags except `--json`
- `--continue-on-error`: skip unresolved refs instead of failing the run
- `--fail-on-ambiguous`: fail if a ref resolves ambiguously
- `--comment-format <template>`: customize pinned version comments with `{ref}`, `{action}`, and `{sha_short}` tokens

### `enforce`

Use policy mode for CI. `enforce` reports allowed refs, violations, invalid exceptions, and exits non-zero when policy fails.

```bash
action-pinner enforce
action-pinner enforce --allow-action "actions/*"
action-pinner enforce --exception "actions/upload-artifact@v3::**/legacy.yml"
action-pinner enforce --json
```

Flags:

- All `scan` flags
- `--allow-action <pattern...>`: allowlist unpinned actions by pattern
- `--exception <rule...>`: allow a specific exception using `<action>[@ref][::workflow-glob]`
- `--continue-on-error`: continue when a ref cannot be resolved
- `--fail-on-ambiguous`: fail if a ref resolves ambiguously

### `pr`

Pin refs, create a branch, and publish a pull request using the `pr` config block.

```bash
action-pinner pr
action-pinner pr --path ".github/workflows"
action-pinner pr --continue-on-error --fail-on-ambiguous
action-pinner pr --comment-format "{ref}"
```

Flags:

- All `scan` flags except `--json`
- `--continue-on-error`: skip unresolved refs instead of failing the run
- `--fail-on-ambiguous`: fail if a ref resolves ambiguously
- `--comment-format <template>`: override the configured version comment template for this run

### `dependabot-snippet`

Generate a `github-actions` Dependabot snippet for pinned workflows.

```bash
action-pinner dependabot-snippet
action-pinner dependabot-snippet --path ".github/workflows" "packages/*/.github/workflows"
action-pinner dependabot-snippet --check
```

Flags:

- `--path <path...>`: workflow file, directory, or glob to scan
- `--check`: compare the generated snippet against `.github/dependabot.yml` or `.github/dependabot.yaml`

## GitHub Action Usage

Run `action-pinner` as a GitHub Action:

```yaml
- uses: jongalloway/action-pinner@v1
  with:
    mode: scan
    config: .action-pinner.json
```

Use `enforce` to gate workflow changes in CI:

```yaml
name: enforce-pinned-actions

on:
  pull_request:
  push:
    branches: [main]

jobs:
  action-pinner:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jongalloway/action-pinner@v1
        with:
          mode: enforce
          config: .action-pinner.json
```

Action inputs:

- `mode`: `scan`, `fix`, `enforce`, or `pr`
- `config`: config file path
- `path`, `exclude_path`, `include_action`, `exclude_action`
- `allow_actions`, `exception_rules`
- `json`

## Pre-commit

Use `action-pinner` as a [pre-commit](https://pre-commit.com/) hook to scan workflow changes before they land:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/jongalloway/action-pinner
    rev: v0.1.0
    hooks:
      - id: action-pinner-scan
```

Available hooks:

- `action-pinner-scan`: runs `action-pinner scan` against `.github/workflows` and fails if unpinned refs are found.
- `action-pinner-fix`: runs `action-pinner fix` against `.github/workflows` to auto-pin refs before commit.

## Configuration

Example `.action-pinner.json`:

```json
{
  "$schema": "./schemas/action-pinner.schema.json",
  "mode": "scan",
  "include": [
    ".github/workflows/**/*.yml",
    ".github/workflows/**/*.yaml"
  ],
  "exclude": [
    ".github/workflows/legacy/**"
  ],
  "repos": [
    "octo-org/service-a",
    "octo-org/service-b"
  ],
  "includeRepos": [
    "platform-*"
  ],
  "excludeRepos": [
    "*-archive"
  ],
  "excludeActions": [
    "actions/cache"
  ],
  "org": {
    "name": "octo-org",
    "includePrivate": true,
    "includeArchived": false
  },
  "enforcement": {
    "enabled": true,
    "failOnUnpinned": true,
    "allowActions": [
      "actions/*",
      "github/codeql-action"
    ],
    "exceptions": [
      {
        "action": "actions/upload-artifact",
        "ref": "v3",
        "workflow": "**/legacy.yml",
        "reason": "Temporary migration exception",
        "expiresAt": "2026-12-31"
      }
    ]
  },
  "pr": {
    "create": true,
    "branchPrefix": "chore/action-pinner",
    "title": "Pin GitHub Actions to commit SHAs",
    "labels": [
      "security",
      "dependencies"
    ],
    "reviewers": [
      "octocat"
    ],
    "assignees": [
      "hubot"
    ]
  },
  "dependabot": {
    "addVersionComments": true,
    "commentFormat": "{ref}",
    "generateConfigSnippet": false
  },
  "githubApiUrl": "https://enterprise.example.com/api/v3",
  "useNetrc": false
}
```

Notes:

- CLI flags override config values.
- `reason` and `expiresAt` make exceptions easier to review and clean up.
- `pr.create: false` creates the branch and commit without publishing a PR.
- `dependabot.commentFormat` supports `{ref}`, `{action}`, and `{sha_short}` tokens. Use `""` for no version comment, or set `dependabot.addVersionComments: false` to suppress comments entirely.

## Authentication

Authentication precedence:

| Priority | Source |
| --- | --- |
| 1 | `--token <token>` |
| 2 | `PIN_ACTIONS_TOKEN` |
| 3 | `.netrc` / `_netrc` when `--use-netrc` is enabled |
| 4 | `GITHUB_TOKEN` |
| 5 | Anonymous GitHub API access |

Examples:

```bash
action-pinner scan --token ghp_xxx
action-pinner scan --use-netrc
action-pinner scan --github-api-url https://enterprise.example.com/api/v3
```

For GitHub Enterprise Server, set `--github-api-url` or `githubApiUrl` in config. See [docs/ENTERPRISE.md](./docs/ENTERPRISE.md).

## Multi-Repo and Org Scanning

Scan explicit repositories:

```bash
action-pinner scan --repo octo-org/service-a octo-org/service-b
```

Discover repositories from an organization, then narrow the set:

```bash
action-pinner scan --github-org octo-org --include-repo "platform-*" --exclude-repo "*-archive"
```

Target a subset of workflow files across selected repos:

```bash
action-pinner scan --github-org octo-org --path ".github/workflows/**" --exclude-path "**/legacy/**"
```

For user-owned repositories, pass explicit `--repo owner/repo` values.

## Enforcement Allowlists and Exceptions

Allowlist broad cases:

```bash
action-pinner enforce --allow-action "actions/*"
```

Add a narrow CLI exception:

```bash
action-pinner enforce --exception "actions/upload-artifact@v3::**/legacy.yml"
```

Config-driven exceptions are better for review history:

```json
{
  "enforcement": {
    "failOnUnpinned": true,
    "allowActions": ["actions/*"],
    "exceptions": [
      {
        "action": "actions/upload-artifact",
        "ref": "v3",
        "workflow": "**/legacy.yml",
        "reason": "Legacy workflow still migrating",
        "expiresAt": "2026-12-31"
      }
    ]
  }
}
```

Rules:

- `allowActions` is pattern-based and broad.
- `exceptions` are specific and auditable.
- Expired or malformed exceptions fail closed.

## Security

- **Fail closed:** unresolved refs, invalid exceptions, and policy violations fail enforcement by default.
- **Token safe:** tokens are redacted from logs; use the smallest possible scopes.
- **Deterministic output:** scans, rewrites, and fingerprints are stable on the same input.

See [SECURITY.md](./SECURITY.md) for the security policy and [docs/ENTERPRISE.md](./docs/ENTERPRISE.md) for GHES guidance.

## Acknowledgments

This project was inspired by [mheap/pin-github-action](https://github.com/mheap/pin-github-action), which pioneered the idea of pinning GitHub Actions to commit SHAs. `action-pinner` is a completely new implementation built from scratch using modern Node.js and the GitHub REST API, designed to address long-standing community requests including:

- [Enterprise GitHub support](https://github.com/mheap/pin-github-action/issues/169)
- [Support netrc auth](https://github.com/mheap/pin-github-action/issues/168)
- [Published as a GitHub Action](https://github.com/mheap/pin-github-action/issues/141)
- [Default to `.github/workflows/`](https://github.com/mheap/pin-github-action/issues/201)

Thank you to [@mheap](https://github.com/mheap) and the contributors to that project for the inspiration.

## Contributing

Clone the repo, install dependencies, and run:

```bash
npm test
npm run lint
npm run build
```

Open an issue or PR at [github.com/jongalloway/action-pinner/issues](https://github.com/jongalloway/action-pinner/issues).
