# Security Policy for action-pinner

## Threat Model

action-pinner is designed for **supply-chain trust**: ensuring GitHub Actions are pinned to known-good SHAs rather than floating tags or branches.

### Protected Against
- Upstream repository takeover (tag/branch redirect)
- Typosquatting in action names
- Accidental use of outdated actions

### Out of Scope
- Verification of action binary contents (see supply-chain attestation)
- Revocation of compromised SHAs (responsibility of workflow author)

## Token Handling

### What We Do
- Accept GitHub tokens via `PIN_ACTIONS_TOKEN` environment variable or CLI `--token` flag
- Use tokens only for GitHub API calls (resolving refs, opening PRs)
- Automatically redact tokens from all output and logs
- Never write tokens to files

### What We Don't Do
- Cache tokens between runs (tokens are ephemeral per invocation)
- Log token values, auth headers, or API URLs containing credentials
- Store tokens in configuration files

### Token Scope Recommendations

| Use Case | Recommended Scopes | Why |
|----------|-------------------|-----|
| Scan public workflows (read-only) | `contents:read` | Minimal public repo access |
| Scan private workflows | `contents:read` on private repos | Limited to target repos |
| Auto-open PRs with fixes | Add `pull_requests:write` | Creates PRs in target repos |
| Org-level scanning | `contents:read` in org context | Scans all org repos (if authorized) |

**Never use:**
- Full `repo` scope (includes delete, admin rights)
- Admin scopes (`admin:repo_hook`, `admin:org`)
- Public gists or other unrelated scopes

## Failure Modes

### Fail-Closed Behavior

action-pinner prioritizes **safety over convenience**:

1. **Unresolved refs** (e.g., tag deleted, branch renamed):
   - Default: Exit with error code 1
   - Override: Use `--continue-on-error` to skip and log as warning

2. **Ambiguous refs** (e.g., tag and branch with same name):
   - Default: Exit with error code 1
   - Override: Use `--fail-on-ambiguous` to re-emphasize (already strict by default)

3. **Rate limits** (GitHub API 429):
   - Automatic retry with exponential backoff
   - If all retries exhausted, exit with error (or warn if `--continue-on-error`)

### Why Fail-Closed?
- Guessing at ref resolution is a security risk
- A failed action-pinner run is better than an incorrect pin
- Users must explicitly acknowledge ambiguity or failures

## Output & Audit Trails

### Evidence Reporting
- Every resolved ref includes:
  - Original ref (what was requested)
  - Resolved SHA (what was pinned)
  - Source repo (where it was resolved)
  - Resolution method (tag vs. branch vs. release)
  - Timestamp (ISO 8601 when resolved)
  - Tool version + config hash (for reproducibility)

### Deterministic Output
- Scan results are always sorted consistently (by workflow path, then ref)
- Rewrites preserve original line endings and inline comments
- Fingerprints are reproducible for audit verification

### PR Evidence
- Each PR opened by action-pinner includes a "Why this SHA?" section
- Evidence shows the ref → SHA mapping + resolution date
- Reviewers can audit the pinning decision

## CI Enforcement Allowlists & Exceptions

action-pinner supports explicit enforcement scoping and exceptions so CI remains strict but practical:

- `enforcement.failOnUnpinned` defaults to `true` (safe fail-closed).
- `enforcement.allowActions` lets you limit enforcement to approved action patterns.
- `enforcement.exceptions` requires explicit exception entries with action and optional `ref` / `workflow`.
- Add `reason` to each exception for audit trails and recurring review.

Recommended process:
1. Keep allowlists minimal and owned by security/platform engineering.
2. Require ticket references in exception `reason`.
3. Review and prune exceptions on a fixed cadence.

## Reporting Security Issues

If you discover a security vulnerability in action-pinner:
1. **Do not open a public issue**
2. **Email:** Contact through GitHub Security Advisory (preferred) or the project maintainer
3. **Include:** Details, steps to reproduce, impact assessment

We will acknowledge within 48 hours and provide a timeline for patching.

## Compliance & Standards

### Recommendations
- [ ] Align with [SLSA](https://slsa.dev/) supply-chain framework (future: attestations, build provenance)
- [ ] Consider CNCF/OpenSSF best practices
- [ ] Support artifact signing (future: cosign attestations)

### Related Resources
- GitHub Actions [security hardening guide](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- OWASP [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- SLSA [Supply-chain Levels for Software Artifacts](https://slsa.dev/)
