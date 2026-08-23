# Hosted-to-self-hosted cutover

The Mend-hosted Renovate App is not removed during bootstrap.

## Preconditions

- The public operations repository is pushed and CI passes.
- `main` requires the `validate` check, one fresh code-owner approval, conversation resolution, linear history, and applies protection to administrators.
- Every consumer has merged explicit `enabled: true` intent and owns its required checks.
- The private GitHub App is installed with selected access to every enabled consumer.
- Repository variable `RENOVATE_APP_CLIENT_ID` and secret `RENOVATE_APP_PRIVATE_KEY` exist.
- A manual full dry-run completes successfully for every discovered consumer.
- Logs bind each consumer checkpoint/config digest, accept only the exact post-upgrade
  command, and show no unexpected writes or Renovate autodiscovery.

## Cutover sequence

1. Record the latest hosted Renovate run and currently open Renovate branches/PRs.
2. Remove or suspend the Mend-hosted App's access to each enabled consumer. Do not delete its historical PRs.
3. Set repository variable `RENOVATE_ENABLED=true` in `renovate-ops`.
4. Immediately dispatch one self-hosted `production` run.
5. Confirm the bot identity is the private GitHub App, existing branches are handled without duplicate PRs, and the Dependency Dashboards remain coherent.
6. Confirm an authenticated release-event run succeeds and no incident issue remains open.

Only after these checks should the hosted App be fully uninstalled if it serves no other repository.

## Rollback

1. Set `RENOVATE_ENABLED=false` and disable the self-hosted `Renovate` workflow.
2. Suspend the private GitHub App installation.
3. Restore selected repository access for the Mend-hosted App.
4. Trigger or wait for one hosted run and inspect existing branches before resuming normal operation.

There must be one production writer at every point in the cutover or rollback.
