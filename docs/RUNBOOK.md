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

Every production attempt has fresh bounded NDJSON logs. `lockfile-error` and missing
completion wait 30 seconds and receive exactly one retry; malformed logs, unexpected
or duplicate repositories, config races, non-lockfile results, and non-retryable
artifact failures stop immediately. Finalization runs only for the exact consumer
whose manifest and complete attempt pass.

## Adoption branch ownership

`automation/renovate/engineering-process-authority` is exclusively bot-owned. Do not
amend, rebase, or push cleanup onto it. Use a normal reviewed branch for a one-time
combined cutover, close any edited bot PR, and let the next release event create a
fresh bot-owned branch.

## Add a consumer

1. In the consumer, merge a strict Renovate config with explicit `enabled: true`,
   `automerge: false`, `draftPR: true`, and branch prefix
   `automation/renovate/`.
2. For a process consumer, require the exact managed adoption command and adoption CI.
3. Verify the consumer's own required checks, independent-review pin, and branch protection.
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
