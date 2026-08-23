# Renovate operations

Publicly auditable control plane for the self-hosted Renovate instance that manages
engineering-process consumers without a central repository registry. Credentials
remain encrypted GitHub Actions secrets and are never committed.

## Operating model

An authenticated `engineering-process-published` event starts a bounded discovery
job. A read-only GitHub App installation token enumerates only repositories already
authorized by the repository owner. The controller reads each repository's strict
`.github/renovate.json` or `.github/renovate.json5` from one immutable default-branch
checkpoint and selects only explicit `"enabled": true` intent.

Every selected consumer runs in a separate bounded matrix job with a new
installation token scoped to exactly that repository. Renovate receives one exact
target and keeps autodiscovery disabled. The consumer checkpoint, config path, and
config SHA-256 form an ephemeral manifest that is revalidated before and after the
run and drives outcome validation and adoption finalization.

`automation/renovate/engineering-process-authority` is bot-owned. Humans and agents
must not push commits to it: Renovate correctly blocks updates after a manual branch
edit. A one-time process cutover that combines project cleanup with adoption uses a
normal reviewed branch; after that cutover, every authority branch is generated and
updated only by Renovate.

Each consumer's first complete attempt may receive one idempotent recovery attempt
after 30 seconds only for `lockfile-error` or a missing completion. The retry keeps
the same authenticated event, consumer manifest, immutable runtime, and
repository-scoped authorization. Deterministic validation or artifact failures do
not retry. Adoption finalization occurs only for the consumer whose exact run passed.

The only permitted post-upgrade command is:

```text
python .process/adopt-process.py --project-root . --requirements-lock requirements/process.txt
```

Shell execution, arbitrary scripts, plugins, repository discovery inside Renovate,
cross-consumer tokens, and Docker socket access are disabled.

## Bootstrap

1. Run `npm ci --ignore-scripts && npm run check`.
2. Create the public repository and push this reviewed source.
3. Run `npm run bootstrap:protect`. Required CI, independent review, code ownership,
   and immutable history are production preconditions for this operations repo.
4. Run `node scripts/github-app-manifest-server.mjs` and open the printed localhost URL.
5. Review and create the private GitHub App. The callback stores the one-time response
   at `.local/github-app.json` with mode `0600`.
6. Run `node scripts/configure-github.mjs`. It writes the Client ID and private key to
   encrypted repository configuration, keeps `RENOVATE_ENABLED=false`, then deletes
   the local response.
7. Install the App with selected-repository access only after each consumer has
   merged its explicit enabled config and local branch protections.
8. Dispatch `Renovate` with `mode=dry-run` and review every selected consumer result.
9. Follow `docs/CUTOVER.md`; do not let hosted and self-hosted Renovate run in
   production concurrently. Keep production disabled until the dry run is accepted.

## Adding a consumer

Consumer onboarding is owned by the consumer and GitHub authorization; it never
requires a source change in this repository:

1. In the consumer, merge a strict Renovate config with explicit `"enabled": true`,
   `automerge: false`, `draftPR: true`, the standard branch prefix, and the exact
   process-adoption command.
2. Verify the consumer's own required CI, independent review, and branch protection.
3. Grant the GitHub App selected access to that repository.
4. Dispatch a dry run and review the config checkpoint, digest, and proposed changes.

To stop automation, merge `"enabled": false` in the consumer or remove the App's
selected-repository access. No central registry or operations PR is involved.

## Verification

```bash
npm ci --ignore-scripts
npm run check
```

Operational procedures are in `docs/RUNBOOK.md`. Security assumptions are in
`docs/THREAT_MODEL.md`. The single-maintainer authorization and independent-
verification contract is in `docs/GOVERNANCE.md`.
