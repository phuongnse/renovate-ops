# Operations runbook

## Normal operation

The `Renovate` workflow runs when the installed GitHub App delivers a bounded
`engineering-process-published` event and `RENOVATE_ENABLED` is `true`. It validates
the event, creates a read-only discovery token, and selects the intersection of App
installation access and explicit `enabled: true` config at immutable consumer
checkpoints. Manual dispatch defaults to a full dry run.

Each selected repository receives one isolated matrix job and one repository-scoped
write token. Review the run's per-repository result and any open issue named
`Renovate production run is failing`. Never place credentials, raw consumer config,
or private-repository data in public logs or incident comments.

Before local validation or CI profile execution, run `npm ci --ignore-scripts` and
then `processctl setup --project-root . --profile review --apply --allow
project-files`. The setup action rebuilds only exact policy-approved `re2`; the
environment probe must report `Renovate validation runtime ready`. Treat a missing
`re2.node`, install-script inventory drift, runtime import failure, or any Renovate
RE2 fallback diagnostic as deterministic failure. Never use
`RENOVATE_X_IGNORE_RE2`, broaden script approval, or substitute another validator.

Each production attempt has a separate bounded NDJSON log. The first complete result
is classified. `lockfile-error` and missing-completion outcomes wait 30 seconds and
receive exactly one idempotent retry; malformed logs, unexpected or duplicate
repositories, config races, non-lockfile results, and non-retryable artifact failures
stop immediately. A second failure opens or updates the incident. Renovate never
finalizes process adoption.

## Process adoption ownership

Renovate updates the exact package pin and hash lock, runs the single allowlisted
managed adopter, and commits every declared managed path on
`automation/renovate/engineering-process*`. The resulting PR remains non-automerge;
consumer CI verifies the complete materialized checkpoint and an independent reviewer
must approve it before the configured human owner merges it.

## Rotate a reusable policy trust root

1. Introduce the new immutable workflow and verifier in a PR governed by the current
   required verifier and protection context. Do not change the caller or live
   protection in this introduction stage.
2. Merge the introduction through the configured human owner and resolve its exact
   commit on `main`.
3. In a separate lifecycle change, pin self-CI to that exact main commit and prove the
   new policy check on the final checkpoint.
4. Only after the new check passes, switch live branch protection to its exact context.
   Restore the old context if cutover cannot complete.
5. Retire the old caller and workflow only after the new context is active. Never pin
   a reusable workflow to an unmerged commit or weaken protection to break a cycle.

## Add a consumer

1. In the consumer, merge a strict Renovate config with explicit `enabled: true`,
   `automerge: false`, and branch prefix `automation/renovate/`.
2. If it adopts `engineering-process`, verify the package rule is enabled without
   automerge, uses the exact managed adoption command, and includes every managed
   file filter.
3. Verify required CI, semantic review, pinned policy verification, and branch protection.
4. In GitHub App installation settings, grant selected access to the repository.
5. Dispatch a dry run and verify the reported checkpoint/config digest and proposals.

No source change in `renovate-ops` is part of onboarding. To remove a consumer, merge
`enabled: false` first, confirm discovery no longer selects it, then remove App access.
For emergency revocation, remove or suspend App access first.

## Rotate the private key

1. Generate a new private key in GitHub App settings.
2. Replace `RENOVATE_APP_PRIVATE_KEY` in encrypted repository configuration.
3. Dispatch a dry run and confirm read-only discovery and repository-scoped runs.
4. Delete the old key from GitHub and every local machine.

If compromise is suspected, suspend the installation and disable the workflow before diagnosis.

## Failed production run

1. Open the linked workflow run and identify the affected consumer matrix job.
2. Preserve its manifest binding, attempt classification, bounded diagnostic, and exact source.
3. Do not rerun while built-in recovery is active and do not broaden permissions,
   commands, App access, or consumer intent to bypass failure.
4. Fix deterministic defects in their owning repository and run a dry run.
5. Use manual production only as recorded break-glass recovery.

## Emergency stop and rollback

Set `RENOVATE_ENABLED=false`, disable the workflow, and suspend the custom App
installation. Per-consumer revocation removes selected App access. Existing Renovate
PRs remain ordinary branches and can be reviewed or closed independently.

To roll back source, restore the last reviewed operations checkpoint while keeping
the App suspended. Do not restore a durable central consumer registry as a runtime fallback.
