# Decision: org-user-multi-repo-targeting

Implemented repo discovery as owner-scoped targeting with `org.type` (`org` or `user`) plus a CLI `--github-user` flag.

Key decisions:
- Reuse paginated owner enumeration metadata (`full_name`, `default_branch`) so scan avoids a follow-up `repos.get` call for discovered repos.
- Keep repo targeting deterministic with normalized dedupe, stable sorting, include-then-exclude filtering, and exclude-wins semantics.
- Emit both per-repo results and a consolidated merged scan so downstream reporting/enforcement can consume either view.
- For user scans, private repos are only enumerated via `listForAuthenticatedUser` when the authenticated login matches the requested user; otherwise enumeration falls back to public `listForUser`.
