# Han decision: enforcement policy surface

- `enforcement.allowActions` is treated as an allowlist of action patterns that always pass `pin-actions enforce`; it does not narrow scan input.
- `enforcement.exceptions` now supports `justification` and `expiresAt` (with `reason` kept as a backward-compatible alias).
- Expired or malformed exceptions fail closed: enforcement stays non-compliant, offending refs remain violations, and GitHub Action outputs expose compliant/allowed/violation/invalid-exception counts.
