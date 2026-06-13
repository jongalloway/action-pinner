# pin-actions

Modern replacement for `pin-github-action` that scans workflows for unpinned GitHub Actions, resolves refs to commit SHAs, rewrites workflow files, and supports automated PR workflows.

## Highlights

- Repository scanner for unpinned `uses:` entries
- Ref resolver (tag/branch -> SHA) via Octokit and modern GitHub APIs
- Auto-pinning engine with optional `# vX.Y.Z` comments
- PR preparation flow (branch + commit + open PR metadata)
- Evidence sections for resolved SHAs and reproducible run fingerprints
- Multi-repo/org/user scanning with deterministic per-repo and consolidated reporting
- CI enforcement mode
- Config support via `.pin-actions.json`
- Config validation with clear errors for invalid JSON or unknown fields
- CLI mode + GitHub Action mode
- Optional GitHub App mode scaffold

## Use cases

- Scan a single workflow file, a workflow directory, or the default `.github/workflows/` tree.
- Fix unpinned actions in place or run a dry run first to inspect the diff.
- Open a PR with pinned updates after a scan.
- Enforce pinning in CI and fail builds when unpinned actions are found.
- Keep human-readable version comments alongside SHAs for maintainers and Dependabot.
- Configure PR titles, bodies, labels, assignees, and reviewers from `.pin-actions.json`.
- Run against private repositories with `GITHUB_TOKEN`.
- Scan explicit repository lists and org-discovered repositories in one run.
- Normalize path separators so Windows paths and POSIX globs behave consistently.
- Accept POSIX-style glob patterns in config, even when the repository is worked on from Windows.

## Compatibility notes

- Workflow discovery should default to `.github/workflows/` when no path is supplied.
- Config and CLI behavior should support explicit allow/exclude patterns for actions and workflow paths.
- Comment formatting should stay configurable so the pinned version marker remains readable.
- Enterprise GitHub, netrc auth, and pre-commit use cases are part of the compatibility story to preserve from the upstream tool.

## Requirements

- Node.js 20+
- `GITHUB_TOKEN` for resolving private repos or opening PRs

## Quick Start

```bash
npm install
npm run build
node dist/index.js scan
```

## Security & Trust

### Token Safety
- **pin-actions never logs your GitHub token**, even in verbose mode. All credential data is automatically redacted from logs.
- Use a personal access token (PAT) or GitHub App installation token with **minimal necessary scopes**:
  - **For public repos (read-only):** Scopes: `contents:read`
  - **For private repos (read-only):** Scopes: `contents:read` on private repos
  - **For opening PRs (read + write):** Add `pull_requests:write`
  - **Never use:** `admin:repo_hook`, `admin:org`, or `full repo` scopes

### Fail-Closed Behavior
- If a ref cannot be resolved to a SHA, **pin-actions fails by default** (exit code 1).
- Use `--continue-on-error` to skip unresolved refs and continue (logged as warnings).
- If a ref is ambiguous (e.g., both a tag and branch), **pin-actions fails** to avoid guessing.

### Deterministic Output
- pin-actions produces **stable, reproducible output** across runs on the same input.
- Scans and rewrites sort refs consistently.
- Evidence fingerprints include tool version and configuration hash for audit trails.

### Recommended Practices
1. Use a dedicated GitHub App or token scoped to specific repos
2. Rotate tokens regularly
3. Review generated PRs before merging (pin-actions is a tool for verification, not automation)
4. Enable branch protections requiring approval on `.github/workflows/` changes

For more details, see [SECURITY.md](./SECURITY.md).

## Commands

```bash
pin-actions scan
pin-actions scan --json
pin-actions scan --github-org octo-org --include-repo "platform-*" --exclude-repo "*-archive"
pin-actions scan --github-user octocat --include-repo "demo-*"
pin-actions scan --exclude-path ".github/workflows/legacy/**" --exclude-action "actions/cache"
pin-actions fix --dry-run
pin-actions fix
pin-actions enforce
pin-actions enforce --allow-action "actions/*" --exception "actions/upload-artifact@v3::**/legacy.yml"
pin-actions pr
pin-actions dependabot-snippet
```

### CLI filter and targeting options

- `--path <path...>`: include workflow paths (overrides config `include`)
- `--exclude-path <path...>`: exclude workflow paths (overrides config `exclude`)
- `--include-action <pattern...>`: include only matching actions
- `--exclude-action <pattern...>`: exclude matching actions
- `--repo <owner/repo...>`: explicit multi-repo targets
- `--github-org <org>`: org-level target selection
- `--github-user <user>`: user-level target selection
- `--include-repo <pattern...>` / `--exclude-repo <pattern...>`: repo allow/exclude patterns for multi-repo targeting

## Configuration

Default config file: `.pin-actions.json`  
Schema: `schemas/pin-actions.schema.json`

```json
{
  "$schema": "./schemas/pin-actions.schema.json",
  "mode": "scan",
  "include": [".github/workflows/**/*.yml", ".github/workflows/**/*.yaml"],
  "exclude": [".github/workflows/legacy/**"],
  "repos": ["octo-org/service-a", "octo-org/service-b"],
  "includeRepos": ["platform-*"],
  "excludeRepos": ["*-archive"],
  "excludeActions": ["actions/cache"],
  "org": {
    "name": "octocat",
    "type": "user",
    "includePrivate": true,
    "includeArchived": false
  },
  "enforcement": {
    "enabled": true,
    "failOnUnpinned": true,
    "allowActions": ["actions/*", "github/*"],
    "exceptions": [
      {
        "action": "actions/upload-artifact",
        "ref": "v3",
        "workflow": "**/legacy.yml",
        "justification": "Temporary migration exception; tracked in SEC-1234",
        "expiresAt": "2026-12-31"
      }
    ]
  }
}
```

### CI enforcement allowlists and exceptions

- **Safe default:** `enforcement.failOnUnpinned` defaults to `true`, so violations fail CI.
- `enforcement.allowActions` is an allowlist of action patterns (`owner/repo` or `owner/*`) that always pass enforcement.
- `enforcement.exceptions` supports explicit, reviewable carve-outs with `action`, optional `ref`, optional `workflow`, optional `justification`, and optional `expiresAt`.
- `reason` remains supported as a backward-compatible alias for `justification`.
- Expired or malformed exceptions fail closed and are called out explicitly in `pin-actions enforce` output.
- CLI overrides:
  - `pin-actions enforce --allow-action "<pattern>"`
  - `pin-actions enforce --exception "<action>[@ref][::workflow-glob]"`

### Config precedence

When the same setting is provided in multiple places, precedence is:

1. CLI flags
2. `.pin-actions.json`
3. built-in defaults

For example, `--path` overrides the `include` list from config.

## Authentication

pin-actions supports multiple authentication methods with clear precedence:

### Token-Based Authentication (Recommended)

```bash
# 1. CLI flag (highest priority)
pin-actions scan --token ghp_xxxxxxxxxxxx

# 2. Environment variable
export PIN_ACTIONS_TOKEN=ghp_xxxxxxxxxxxx
pin-actions scan

# 3. GitHub Actions automatically sets GITHUB_TOKEN
# (use with `with: token: ${{ secrets.GITHUB_TOKEN }}`)
```

### Using .netrc (Private Repositories)

For private repositories without explicit tokens, use your `.netrc` file:

```
# ~/.netrc (Unix/macOS) or %USERPROFILE%\_netrc (Windows)
machine github.com
login your-username
password ghp_xxxxxxxxxxxx

machine enterprise.example.com
login your-username
password ghes-token-xxxxxxxxxxxx
```

Then enable netrc authentication:

```bash
pin-actions scan --use-netrc
```

### Authentication Precedence

pin-actions selects authentication in this order:

1. `--token` CLI flag
2. `PIN_ACTIONS_TOKEN` environment variable
3. `.netrc` file (if `--use-netrc` flag is set)
4. `GITHUB_TOKEN` environment variable (GitHub Actions)
5. Anonymous (rate-limited to 60 requests/hour)

### Token Scopes

For minimal security, use these scopes:

- **Read-only scopes:** `contents:read`
- **PR creation:** add `pull_requests:write`
- **GHES:** Same scopes as github.com

**Never use:** full `repo`, `admin`, or org admin scopes.

## GitHub Enterprise Server (GHES)

pin-actions supports GitHub Enterprise Server with custom API endpoints.

### Configuration

Set the GHES API endpoint via (in order of precedence):

1. CLI flag: `pin-actions scan --github-api-url https://enterprise.example.com/api/v3`
2. Environment variable: `export GITHUB_API_URL=https://enterprise.example.com/api/v3`
3. Config file `.pin-actions.json`:
   ```json
   {
     "githubApiUrl": "https://enterprise.example.com/api/v3"
   }
   ```

### Example: GitHub Enterprise Server

```bash
# Using CLI flag
pin-actions scan --github-api-url https://enterprise.example.com/api/v3 --token $GHES_TOKEN

# Using environment variable
export GITHUB_API_URL=https://enterprise.example.com/api/v3
pin-actions scan --token $GHES_TOKEN
```

### Notes

- GHES API URLs typically follow pattern: `https://<hostname>/api/v3`
- Use a token scoped to your GHES instance
- Token scopes for GHES follow the same model as github.com
- See [Enterprise Adoption Guide](./docs/ENTERPRISE.md) for org-wide deployments

### PR configuration

The `pr` block supports:

- `create`
- `branchPrefix`
- `title`
- `bodyTemplate`
- `labels`
- `reviewers`
- `assignees`

`bodyTemplate` supports `{{summary}}`, `{{files}}`, `{{references}}`, `{{evidence}}`, `{{fileCount}}`, `{{referenceCount}}`, `{{branch}}`, `{{baseBranch}}`, `{{commitMessage}}`, `{{toolVersion}}`, `{{configHash}}`, and `{{runFingerprint}}`.

## GitHub Action usage

This repository includes a Node action descriptor at `.github/action.yml`.

- `mode` (scan|fix|enforce|pr)
- `config` (path to `.pin-actions.json`)
- `path` (workflow file or directory to scan)
- `exclude_path`, `include_action`, `exclude_action`
- `allow_actions`, `exception_rules` for enforcement mode

### Example: enforce in CI

```yaml
jobs:
  pin-actions-enforce:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: jongalloway/pin-actions/.github/action.yml@main
        id: pin-actions
        with:
          mode: enforce
          config: .pin-actions.json
      - name: Show enforcement summary
        run: |
          echo "Compliant: ${{ steps.pin-actions.outputs.compliant }}"
          echo "Allowed: ${{ steps.pin-actions.outputs.allowed_count }}"
          echo "Violations: ${{ steps.pin-actions.outputs.violation_count }}"
          echo "Invalid exceptions: ${{ steps.pin-actions.outputs.invalid_exception_count }}"
```

Action outputs in `enforce` mode:

- `compliant`
- `allowed_count`
- `violation_count`
- `invalid_exception_count`
- `fingerprint`
- `config_hash`

## Upstream coverage we should keep visible

The upstream project has open issues and PRs that map to practical user-facing cases worth keeping documented here:

- Windows/path normalization for globbing and workflow discovery
- Defaulting to `.github/workflows/` when no path is passed
- Support for Enterprise GitHub and private repo authentication
- Better comment formatting for pinned refs
- Pre-commit and publish-as-an-action workflows
- Tag-selection heuristics when multiple valid refs exist

## Status

This is a scaffold aligned to the PRD in `docs/PRD.md`, with core modules and command surfaces in place for iterative implementation.
