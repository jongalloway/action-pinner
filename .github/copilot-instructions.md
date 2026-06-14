# Copilot instructions for action-pinner

## Project overview

- `action-pinner` is a TypeScript CLI and GitHub Action for finding mutable GitHub Actions refs like `@v4` or `@main`, resolving them to immutable commit SHAs, and enforcing that policy in CI.
- Core workflows are: scan existing workflow files, rewrite refs in place, enforce policy, and optionally create a PR with the pinned updates.

## Build and test

Run from the repository root:

```bash
npm ci
npm run lint
npm run build
npm test
```

- `npm run lint` is type-check linting via `tsc --noEmit`.
- `npm run build` produces `dist/index.js`. 
- To test enforcement locally after a build, run:

```bash
node dist/index.js enforce
```

## Code structure

Primary modules live in `src/`:

- `cli.ts` - CLI command definitions and output rendering
- `scanner.ts` - workflow discovery and `uses:` ref scanning
- `resolver.ts` - GitHub ref-to-SHA resolution
- `pinner.ts` - workflow rewriting and SHA pin insertion
- `config.ts` - `.action-pinner.json` loading and defaults
- `enforcement.ts` - allowlist / exception policy evaluation
- `multi-repo-scanner.ts` - explicit repo and bulk repo scans
- `org.ts` - org and user repository enumeration
- `report.ts` - summaries, fingerprints, and evidence formatting
- `pr.ts` - branch, commit, and pull request creation
- `action-mode.ts` - GitHub Action entrypoint behavior

Related helpers also exist for Dependabot comments, auth, workflow path handling, and logging.

## Workflow editing rules

- Always pin third-party GitHub Actions to full commit SHAs.
- Preserve or add readable version comments such as `# v4` when pinning so Dependabot and reviewers can map SHAs back to versions.
- Do not replace local actions, Docker image refs, or unrelated workflow syntax unless the task requires it.
- If you change workflow pinning behavior, update tests that cover rewritten workflow output.

## Change guidance

- Prefer small, surgical edits in the relevant `src/` module and matching tests in `tests/`.
- Keep CLI text, JSON output, config behavior, and README/docs aligned when behavior changes.
- Validate behavior with the full repo checks before handing work back.

## PR conventions

- Use conventional commit / PR titles when possible (`feat:`, `fix:`, `docs:`).
- In the PR description or handoff, summarize user-visible behavior, affected commands, and validation run (`npm run lint`, `npm run build`, `npm test`).
- Call out workflow security impact explicitly when a change affects pinning, enforcement, or PR automation.
