# Provenance and Supply-Chain Trust

`action-pinner` helps you trust what your workflows run, and it should also be possible to evaluate whether you trust `action-pinner` itself.

## What action-pinner provides today

- **Immutable SHA pinning:** replacing floating tags and branches with commit SHAs helps prevent tag-retargeting and similar supply-chain attacks.
- **Evidence reports:** each resolved pin records the original ref, resolved SHA, source repository, and resolution details so reviewers can trace why a SHA was chosen.
- **Run fingerprints:** deterministic fingerprints let you prove what configuration and inputs produced a given run.
- **Fail-closed enforcement:** enforcement exits non-zero by default when refs cannot be resolved or policy is violated, which helps prevent accidental bypass.

For related security behavior, see [SECURITY.md](../SECURITY.md). For least-privilege token guidance, see [SCOPES.md](./SCOPES.md).

## Verifying trust in action-pinner

- **Open source and auditable:** `action-pinner` is MIT-licensed and published in a public repository, so you can inspect the source, workflows, and history yourself.
- **CI on every PR:** pull requests run the project's build, lint, and test checks in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- **Dogfooding pinned Actions:** the CI workflow pins the GitHub Actions it uses to full commit SHAs, so the project applies its own guidance.
- **Planned npm provenance:** future npm publishing should use npm's `--provenance` support so consumers can verify where published packages came from.
- **Planned build attestations:** future releases should add GitHub artifact attestations and target SLSA Build Level 2+ style provenance.

## Complementary supply-chain practices

`action-pinner` is one layer, not the whole program. Pair it with:

- **Dependabot** for dependency and GitHub Action update automation.
- **GitHub dependency graph and security advisories** to surface vulnerable dependencies.
- **[OpenSSF Scorecard](https://securityscorecards.dev/)** to assess repository security signals.
- **Sigstore / cosign** for artifact signing and verification if you distribute internal builds or release artifacts in the future.

## Current gaps

Being explicit about today's limits:

- `action-pinner` does **not** publish signed releases yet.
- `action-pinner` does **not** generate an SBOM yet.
- npm provenance will arrive with the first npm publish flow; it is not available until packages are actually published.

If you need stronger end-to-end assurances today, treat `action-pinner` as auditable source plus CI-validated build logic, and add your own release verification controls around the version you consume.
