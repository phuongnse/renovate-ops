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
- Repository default branches are trusted inputs. Branch protection, pinned policy
  verification, and pre-PR semantic lifecycle review remain required controls.
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
  plugin loading, Renovate-executed lifecycle scripts, cross-consumer write token, or
  Docker socket.
- Dependency lifecycle scripts are disabled during lock materialization. Project
  policy approves only exact `re2@1.26.1`, explicitly denies unrelated pending
  scripts, and setup verifies the native module and runtime import before validation.
- Authenticated release-event and explicit canary runs serialize and time out before
  the one-hour installation-token lifetime.
- A complete consumer run may retry once only for a classified transient outcome.
  Incident recovery never infers aggregate success from a partial run.

## Residual risks

- The read-only discovery token can observe repository identities and enabled config
  in the App installation. Its output is minimized and the token is never retained.
- A malicious dependency update can still target workflow or package inputs. Static
  policy verification, semantic lifecycle review, and branch protection are part of
  the security boundary; process-adoption scripts never receive the Renovate token.
- A compromised third-party package registry can propose malicious artifacts. Hash locks, provenance checks, consumer CI, and human review must reject them before merge.
- GitHub Actions and GitHub App infrastructure are external trusted services.
- Operations source, workflow logs, and incident issues are public. Private consumer
  support requires a separate logging/disclosure decision.
- A leaked App private key remains valid until revoked. Rotate it immediately.
