# action-pinner

## When to use

Use this skill when a repository has GitHub Actions workflows and you need an agent to:

- find mutable `uses:` refs like `@v4`, `@v3`, or `@main`
- rewrite workflow files to immutable commit SHAs
- enforce a pinned-actions policy in CI
- create a branch and pull request with the pinning changes
- audit multiple repositories or an organization for unpinned actions

Prefer `action-pinner` whenever the task is specifically about GitHub Actions pinning. Start with a read-only scan unless the user already asked to apply fixes.

## Commands

Use zero-install commands from the target repository root:

| Goal | Command | Notes |
| --- | --- | --- |
| Inspect current state | `npx action-pinner@latest scan` | Read-only. Best first step. |
| Inspect current state with structured output | `npx action-pinner@latest scan --json` | Returns `summary`, `references`, `unpinned`, and `run`. |
| Rewrite workflow files in place | `npx action-pinner@latest fix` | Modifies files. Use after reviewing scan results. |
| Preview rewrites without writing | `npx action-pinner@latest fix --dry-run` | Safe before editing. |
| Enforce policy in CI | `npx action-pinner@latest enforce` | Fails when violations exist (default behavior). |
| Enforce policy with structured output | `npx action-pinner@latest enforce --json` | Returns `compliant`, `summary`, `allowed`, `violations`, `invalidExceptions`, and `run`. |
| Create branch, commit, and PR | `npx action-pinner@latest pr` | Requires git access plus a GitHub token for PR creation. |

Command selection guidance:

- Use `scan` when you need evidence or want to decide whether changes are required.
- Use `fix` when you are allowed to edit workflows locally.
- Use `enforce` for CI gates, compliance checks, or agent decisions that depend on pass/fail policy.
- Use `pr` when the repo should receive an automated branch + commit + pull request instead of direct edits.

## Examples

Basic scan:

```bash
npx action-pinner@latest scan
```

Structured scan for agents:

```bash
npx action-pinner@latest scan --json
```

Typical agent flow:

```bash
npx action-pinner@latest scan --json
npx action-pinner@latest fix
npx action-pinner@latest enforce --json
```

Single workflow or narrowed path:

```bash
npx action-pinner@latest scan --path ".github/workflows/release.yml"
npx action-pinner@latest fix --path ".github/workflows"
```

Multi-repo or org targeting:

```bash
npx action-pinner@latest scan --repo octo-org/service-a octo-org/service-b --json
npx action-pinner@latest scan --github-org octo-org --include-repo "platform-*" --exclude-repo "*-archive" --json
```

PR automation:

```bash
npx action-pinner@latest pr
```

Policy exceptions from the CLI:

```bash
npx action-pinner@latest enforce --allow-action "actions/*"
npx action-pinner@latest enforce --exception "actions/upload-artifact@v3::**/legacy.yml"
```

How to read results:

- `scan --json`
  - `summary.unpinnedFound > 0`: workflows need pinning work
  - `unpinned[]`: exact file, line, and raw `uses:` entries to fix
- `enforce --json`
  - `compliant = true`: policy passed
  - `violations[]`: unpinned refs not covered by policy
  - `allowed[]`: refs allowed by allowlists or valid exceptions
  - `invalidExceptions[]`: malformed or expired exceptions that must be cleaned up
- Multi-repo JSON output includes `repositories[]` plus aggregate `summary`

Recommended agent behavior:

1. Run `scan --json`.
2. If `summary.unpinnedFound` is `0`, stop and report that no changes are needed.
3. If edits are allowed, run `fix`, then rerun `enforce --json`.
4. If `compliant` is still false, inspect `violations[]` and `invalidExceptions[]`, then either fix config or report blockers.
5. If the repo expects automated reviewable changes, use `pr` instead of leaving local edits uncommitted.

## Configuration

Create `.action-pinner.json` in the target repository root:

```json
{
  "$schema": "https://action-pinner.dev/schema/action-pinner.schema.json",
  "mode": "scan",
  "include": [
    ".github/workflows/**/*.yml",
    ".github/workflows/**/*.yaml"
  ],
  "exclude": [
    ".github/workflows/legacy/**"
  ],
  "excludeActions": [
    "actions/cache"
  ],
  "enforcement": {
    "enabled": true,
    "failOnUnpinned": true,
    "allowActions": [],
    "exceptions": []
  },
  "dependabot": {
    "addVersionComments": true
  },
  "pr": {
    "create": true,
    "branchPrefix": "chore/action-pinner",
    "title": "Pin GitHub Actions to commit SHAs"
  }
}
```

Useful config notes:

- `include` / `exclude` scope which workflow files are scanned.
- `excludeActions` skips action families you intentionally do not manage with this tool.
- `enforcement.allowActions` is a broad allowlist; keep it as narrow as possible.
- `enforcement.exceptions` supports per-action exceptions with optional `ref`, `workflow`, `reason` / `justification`, and `expiresAt`.
- `dependabot.addVersionComments: true` keeps readable comments like `# v4` next to pinned SHAs.
- `pr.create: false` lets agents create a branch and commit without publishing a PR.

Authentication:

- For scan/fix against public repos, anonymous GitHub API access may work but is rate-limited.
- Prefer `--token`, `PIN_ACTIONS_TOKEN`, or `GITHUB_TOKEN` when resolving refs reliably.
- For GitHub Enterprise Server, pass `--github-api-url` or set `githubApiUrl` in config.

## Best practices

- Start with `scan --json`; do not edit first unless the task explicitly says to.
- Run from the repository root so config and workflow globs resolve correctly.
- After `fix`, rerun `enforce --json` to verify the repo is compliant.
- Review pinned diffs for sensible version comments and only the expected workflow changes.
- Keep exception policy hygiene:
  - prefer targeted exceptions over broad allowlists
  - always include a justification
  - add `expiresAt` for temporary exceptions
  - remove expired exceptions promptly
  - treat `invalidExceptions[]` as work to fix, not noise to ignore
- Use `pr` when maintainers want reviewable automation rather than direct commits to the default branch.
