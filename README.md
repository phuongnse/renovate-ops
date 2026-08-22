# Renovate operations

Publicly auditable control plane for the self-hosted Renovate instance that manages the explicitly allowed `phuongnse` repositories. Credentials remain encrypted GitHub Actions secrets and are never committed.

## Operating model

An authenticated `engineering-process-published` event creates a short-lived installation token for the private GitHub App, starts the immutable Renovate container, and processes only `repositories.json`. Repository configuration remains local to each consumer. Delivery is at least once and Renovate is idempotent; there is no scheduled production poll. Renovate may create draft dependency and process-adoption PRs, but it never merges them.

The only permitted post-upgrade command is:

```text
python .process/adopt-process.py --project-root . --requirements-lock requirements/process.txt
```

Shell execution, arbitrary scripts, plugins, repository discovery, and Docker socket access are disabled.

## Bootstrap

1. Run `npm ci --ignore-scripts && npm run check`.
2. Create the public repository and push this reviewed source.
3. Run `npm run bootstrap:protect`. Required CI, independent review, code ownership, and immutable history are production preconditions.
4. Run `node scripts/github-app-manifest-server.mjs` and open the printed localhost URL.
5. Review and create the private GitHub App. The callback stores the one-time response at `.local/github-app.json` with mode `0600`.
6. Run `node scripts/configure-github.mjs`. It writes the Client ID and private key to encrypted repository configuration, keeps `RENOVATE_ENABLED=false`, then deletes the local response.
7. Install the App on selected repositories: `renovate-ops`, `engineering-process`, `axis`, and `axis-reference-product`.
8. Dispatch `Renovate` with `mode=dry-run`. Review all four repository logs.
9. Follow `docs/CUTOVER.md`; do not let hosted and self-hosted Renovate run in production concurrently. Release-event and manual production runs remain disabled until `RENOVATE_ENABLED=true`.

## Adding a consumer

Adding a repository is an auditable authorization change:

1. Prepare and merge the consumer's managed Renovate/process-adoption configuration.
2. Grant the GitHub App selected-repository access to the consumer.
3. Add its exact `phuongnse/name` to `repositories.json` in a reviewed PR.
4. Run a manual dry-run and review the repository result before accepting the first release event.

Both Renovate's target list and the installation token's repository scope are derived from the same allowlist.

## Verification

```bash
npm ci --ignore-scripts
npm run check
```

Operational procedures are in `docs/RUNBOOK.md`. Security assumptions are in `docs/THREAT_MODEL.md`.
The single-maintainer authorization and independent-verification contract is in `docs/GOVERNANCE.md`.
