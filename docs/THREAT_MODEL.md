# Threat model

## Assets

- Ability to read and update contents, workflows, pull requests, issues, checks, and
  statuses in consumers that explicitly enable this control plane.
- GitHub App private key stored as the `RENOVATE_APP_PRIVATE_KEY` Actions secret.
- Release and process-adoption integrity in each selected consumer.

## Trust boundaries

- The App private key enters only pinned token-minting actions.
- A discovery token has read-only contents/metadata access across repositories in the
  App installation. It is used only to read repository identity, the default-branch
  checkpoint, and bounded consumer config; it never enters Renovate.
- Every Renovate matrix job receives a different short-lived write token scoped to
  exactly one repository. Consumer commands cannot access a sibling token.
- Source-controlled intent belongs to the consumer's protected default branch.
  Explicit `enabled: true` cannot grant access unless the GitHub App installation
  independently authorizes that repository.
- The ephemeral consumer manifest binds repository, default branch, checkpoint,
  config path, and config digest. The job revalidates it before and after Renovate.
- GitHub-hosted runners are ephemeral. The Renovate container receives no Docker socket.
- Dependency metadata and package artifacts are untrusted external inputs. Consumer
  CI validates generated locks and adoption output before merge.

## Enforced controls

- No central consumer registry and no Renovate autodiscovery.
- Discovery accepts at most 64 App-authorized repositories in one bounded API page,
  bounded config files, strict JSON, an exact owner, and explicit enabled intent.
- Missing or disabled intent is not selected. Invalid, ambiguous, oversized, racing,
  archived, or inaccessible selected state fails closed.
- No onboarding without a reviewed consumer Renovate config and selected GitHub App
  installation access.
- Third-party actions use immutable commit SHAs; the Renovate image uses a
  multi-platform OCI digest.
- No personal access token, arbitrary shell executor, arbitrary post-upgrade command,
  plugin loading, lifecycle scripts, cross-consumer write token, or Docker socket.
- Authenticated release-event and explicit canary runs serialize and time out before
  the one-hour installation-token lifetime.
- A complete consumer run may retry once only for a classified transient outcome.
  Finalization and incident recovery never infer aggregate success from a partial run.

## Residual risks

- A malicious reviewed-and-merged adoption script can access its own repository token
  during its run. Required review and branch protection remain part of the boundary.
- The read-only discovery token can observe repository identities and enabled config
  in the App installation. Its output is minimized and the token is never retained.
- A compromised registry can propose malicious artifacts. Hash locks, provenance,
  consumer CI, and human merge authorization must reject them.
- GitHub Actions and GitHub App infrastructure are external trusted services.
- Operations source, workflow logs, and incident issues are public. Private consumer
  support requires a separate logging/disclosure decision.
- A leaked App private key remains valid until revoked. Rotate it immediately.
