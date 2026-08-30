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
run and drives exact outcome validation.

Engineering-process adoption is materialized by the consumer's exact managed runner
inside the Renovate branch. The resulting draft PR runs project verification and
requires independent semantic review before the configured human owner can merge it.

Each consumer's first complete attempt may receive one idempotent recovery attempt
after one fixed five-minute registry-propagation window only for `lockfile-error`, a
missing completion, or an exact engineering-process version that the package index
has not exposed yet. The retry keeps the same authenticated event, consumer manifest,
immutable runtime, and repository-scoped authorization. Every other deterministic
validation or artifact failure stops immediately. No static check or Renovate
finalizer can satisfy semantic review requirements or mark an adoption candidate
ready.

Shell execution, arbitrary scripts, plugins, repository discovery, and Docker socket
access are disabled. The only post-upgrade command allowed by the administrator is
the anchored managed adoption runner; every other command remains denied.

## Bootstrap

1. Run `npm ci --ignore-scripts`, then
   `processctl setup --project-root . --profile review --apply --allow project-files`,
   then `npm run check`.
2. Create the public repository and push this reviewed source.
3. Run `npm run bootstrap:protect`. Required CI, immutable policy verification, code ownership, and immutable history are production preconditions. Semantic checkpoint review remains a separate pre-PR engineering-process gate.
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
   `draftPR: true`, and the standard branch prefix. If the repository pins
   `engineering-process`, its package rule must also set `draftPR: true` and contain
   the exact managed adoption command and file filters.
2. Verify the consumer's own required CI, semantic review, supplemental policy
   verification, and branch protection.
3. Grant the GitHub App selected access to that repository.
4. Dispatch a dry run and review the config checkpoint, digest, and proposed changes.

To stop automation, merge `"enabled": false` in the consumer or remove the App's
selected-repository access. No central registry or operations PR is involved.

## Verification

```bash
npm ci --ignore-scripts
processctl setup --project-root . --profile review --apply --allow project-files
npm run check
```

The committed npm `allowScripts` policy permits only exact `re2@1.26.1` and
explicitly denies `core-js-pure` and `dtrace-provider`. Setup rebuilds only `re2`.
The environment probe then binds the lock's complete install-script inventory, the
regular `node_modules/re2/build/Release/re2.node` file, exact package version, and a
working native import before either unchanged Renovate validator runs. Do not set
`RENOVATE_X_IGNORE_RE2`, suppress validator output, or replace the canonical commands.

Operational procedures are in `docs/RUNBOOK.md`. Security assumptions are in `docs/THREAT_MODEL.md`.
The single-maintainer authorization, semantic-review boundary, and policy-verification contract are in `docs/GOVERNANCE.md`.
