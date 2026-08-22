# Operations runbook

## Normal operation

The `Renovate` workflow runs in production when the installed GitHub App delivers a bounded `engineering-process-published` repository event and repository variable `RENOVATE_ENABLED` is `true`. The workflow validates the App sender, publisher repository, package, tag/version pair, and attestation digest before creating its separate allowlisted installation token. Manual invocations default to full dry-run and can run before activation; manual production remains an explicit break-glass canary and requires `RENOVATE_ENABLED=true`.

Review the public operations repository's Actions history and any open issue named `Renovate production run is failing`. Successful recovery closes that incident automatically. Never place credentials or private-repository data in workflow logs or incident comments.

## Add a repository

1. Verify the repository is owned by `phuongnse`, has required branch protection, and contains a reviewed Renovate config.
2. If it adopts `engineering-process`, verify its post-upgrade command exactly matches the global allowlist and its adoption CI blocks merge on drift.
3. In the GitHub App installation settings, add selected access to the repository.
4. Add the exact full name to `repositories.json` through a pull request.
5. Run `npm run check`, merge, and dispatch a dry-run.
6. Confirm the log shows the expected config and proposed changes before accepting a release-event production run.

Removing a repository is the reverse: remove it from `repositories.json` first, merge, then remove App installation access.

## Rotate the private key

1. Generate a new private key in the GitHub App settings.
2. Replace the encrypted `RENOVATE_APP_PRIVATE_KEY` Actions secret in the operations repository.
3. Dispatch a dry-run and confirm token creation and all repository scans.
4. Delete the old private key from the GitHub App settings and from every local machine.

Rotate immediately if the key may have been exposed. Do not wait for the dry-run if active compromise is suspected: suspend the installation and disable the workflow first.

## Failed production run

1. Open the linked workflow run from the incident issue.
2. Determine whether failure occurred during token minting, container startup, lookup, lock generation, or post-upgrade adoption.
3. Do not broaden permissions or `allowedCommands` to bypass a failure.
4. Fix through a reviewed PR, dispatch a dry-run, then dispatch one production canary.
5. Confirm the incident closes after a successful production run.

## Emergency stop and rollback

Set `RENOVATE_ENABLED=false`, disable the `Renovate` workflow in repository Actions settings, and suspend the custom GitHub App installation. Existing Renovate PRs remain ordinary GitHub branches and can be reviewed or closed independently.

If service must be restored with the Mend-hosted App, ensure the custom workflow is disabled before re-enabling hosted repository access. Never run both production writers concurrently.
