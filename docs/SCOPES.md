# Least-Privilege GitHub Token Scopes

`action-pinner` is designed to work with the narrowest permissions possible. Prefer fine-grained personal access tokens or GitHub App installation tokens over classic personal access tokens.

## Quick reference

| Use case | Token required? | Preferred minimum permission | Classic PAT fallback |
| --- | --- | --- | --- |
| Scan or pin public repositories | No | None | None |
| Scan or pin private repositories | Yes | Repository access limited to the target repos + **Contents: Read** | `repo` |
| Create pull requests with `action-pinner pr` | Yes | **Contents: Read & Write** and **Pull requests: Write** | `repo` |
| Enumerate repositories in an organization | Sometimes | **Metadata: Read** on selected repos, plus **Members: Read** only if org visibility requires it | `read:org` |
| Use a GitHub App instead of a PAT | Yes | Installation token with only the repositories and permissions above | Not applicable |

## Guidance by scenario

### Public repositories

You can scan public repositories without a token. Add a token only if you need higher rate limits or private repository access.

### Private repositories

For read-only scans and local pinning, grant access only to the repositories you need and use **Contents: Read**. Avoid broader write permissions unless you are actually creating branches or pull requests.

### Pull request creation

`action-pinner pr` needs enough access to push a branch and open a pull request. For fine-grained tokens, that usually means:

- **Contents: Read & Write**
- **Pull requests: Write**

If your environment only supports classic PATs, `repo` is the fallback, but it is broader than necessary.

### Organization-wide discovery

If you scan repositories across an organization, start with repository-scoped access to only the repos you need. Add org-level visibility such as **Members: Read** (or classic `read:org`) only when repository discovery or membership checks require it.

## Recommendations

- Prefer **fine-grained PATs** over classic PATs.
- Prefer **GitHub App installation tokens** for automation when possible.
- Avoid admin-level scopes such as `admin:org` or `admin:repo_hook`.
- Do not paste tokens into logs, URLs, shell history, or workflow output.
