# Enterprise Adoption Guide

## Checklist for GHES Deployments

- [ ] Configure GHES API endpoint via environment variable or config file
- [ ] Create a scoped GitHub App or PAT for pin-actions
- [ ] Test connectivity to GHES instance: `pin-actions scan --github-api-url <GHES_URL> --token <TEST_TOKEN>`
- [ ] Set up repository-level or org-level policies requiring PR reviews
- [ ] Configure branch protection on `.github/workflows/` to require approval
- [ ] Review and test PR evidence before merging
- [ ] Document token rotation schedule (recommend quarterly)

## Integration with CI/CD

### GitHub Actions

```yaml
name: Pin Actions
on: [workflow_dispatch]

jobs:
  pin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - name: Install pin-actions
        run: npm install -g pin-actions
      - name: Run pin-actions
        env:
          PIN_ACTIONS_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_API_URL: ${{ secrets.GHES_API_URL }}  # if using GHES
        run: pin-actions pr --open --fail-on-ambiguous
```

### GitLab CI

```yaml
pin-actions:
  image: node:20
  script:
    - npm install -g pin-actions
    - pin-actions scan --github-api-url $GITHUB_ENTERPRISE_URL
```

## Multi-Repo Organization Scanning

For org-level deployments:

```bash
# Discover target scope for org scanning (requires read permissions)
pin-actions scan --github-org acme-corp --include-repo "platform-*" --exclude-repo "*-archive" --token $ORG_TOKEN

# Explicit repo targeting
pin-actions scan --repo acme-corp/service-a acme-corp/service-b --token $ORG_TOKEN
```

`scan` now executes per selected repository and emits deterministic per-repo plus aggregate results.

## CI Enforcement wiring (allowlists + exceptions)

```yaml
- name: Enforce pinned actions
  run: >
    pin-actions enforce
    --allow-action "actions/*"
    --exception "actions/upload-artifact@v3::**/legacy.yml"
```

Prefer config-driven policy in `.pin-actions.json` for auditability:

- `enforcement.allowActions`: explicit enforcement scope
- `enforcement.exceptions`: explicit exception objects (`action`, optional `ref`, `workflow`, `reason`)
- `enforcement.failOnUnpinned`: leave `true` for safe default fail-closed behavior

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Invalid or expired token | Verify token scopes and expiration |
| 404 Not Found | Wrong API URL | Check GHES API endpoint (often `.../api/v3`) |
| SSL certificate error | Self-signed GHES cert | Configure trusted CAs or disable cert validation (not recommended for prod) |
| Rate limited (429) | Too many API calls | Use caching and batching; retry with backoff |

## Security Best Practices

1. **Use scoped tokens:** Limit token permissions to `contents:read` or `pull_requests:write`
2. **Rotate tokens:** Implement quarterly token rotation
3. **Review PRs:** Always review pin-actions PRs before merging
4. **Enable branch protection:** Require approval on `.github/workflows/` changes
5. **Audit logs:** Enable GitHub audit logs for all pin-actions operations
6. **No tokens in config:** Never commit tokens to `.pin-actions.json` or config files
