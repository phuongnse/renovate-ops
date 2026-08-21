# Threat model

## Assets

- Ability to read and update contents, workflows, pull requests, issues, checks, and statuses in the selected repositories.
- GitHub App private key stored as the `RENOVATE_APP_PRIVATE_KEY` Actions secret.
- Release and consumer-adoption integrity in repositories Renovate can update.

## Trust boundaries

- The private key enters only the pinned token-minting action. Renovate receives an installation token, not the private key.
- The installation token is limited to `repositories.json`, expires within one hour, and is revoked at job cleanup.
- GitHub-hosted runners are ephemeral. The Renovate container receives no Docker socket.
- Repository default branches are trusted inputs. A merged change to a managed adoption script can change what the exact allowed command does, so branch protection and independent review remain required controls.
- Dependency metadata and package artifacts are untrusted external inputs. Consumer CI validates generated locks and adoption output before merge.

## Enforced controls

- No autodiscovery; an exact, version-controlled allowlist is mandatory.
- No onboarding of repositories without a committed Renovate configuration.
- Third-party actions use immutable commit SHAs; the Renovate image uses a multi-platform OCI digest.
- No personal access token, arbitrary shell executor, arbitrary post-upgrade command, plugin loading, lifecycle scripts, or Docker socket.
- Scheduled runs serialize and time out before the one-hour installation-token lifetime.
- Production failures open or update an issue in the public operations repository; recovery closes it. Incident content contains no credential or private-repository data.
- Renovate and process-adoption PRs are draft and never automerged.

## Residual risks

- A malicious reviewed-and-merged adoption script can access the installation token during its run. Required review and branch protection are part of the security boundary.
- A compromised third-party package registry can propose malicious artifacts. Hash locks, provenance checks, consumer CI, and human review must reject them before merge.
- GitHub Actions and GitHub App infrastructure are external trusted services.
- Operations source, workflow logs, and incident issues are public. Managed repositories must remain public unless logging and incident disclosure controls are redesigned first.
- A leaked App private key remains valid until revoked. Rotate immediately on suspected disclosure.
