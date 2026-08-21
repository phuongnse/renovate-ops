# Single-maintainer governance

## Authorization model

This repository and its allowlisted consumers declare `single-maintainer` governance. A merge by `phuongnse` is the sole human authorization. The policy does not require a second human approval when no second maintainer exists and does not manufacture independence by changing Git authorship.

Every default-branch change must still use a pull request and pass two separate control planes:

1. Repository-owned build, test, and contract checks verify project behavior.
2. The immutable reusable workflow in this repository publishes an `independent-review` check and bounded evidence from a clean, read-only runner.

The merge button is enabled only after both control planes pass. Adoption and release pull requests never automerge.

## Independent automated verification

Consumers reference `.github/workflows/independent-review.yml` by a full commit SHA. The called workflow uses GitHub's `job.workflow_repository` and `job.workflow_sha` contexts to check out the verifier implementation co-located with that exact workflow revision. Consumer pull requests cannot select a different verifier after the caller SHA is pinned and protected.

The verifier:

- accepts only pull requests targeting `main` in `repositories.json`;
- binds evidence to full base and head commit SHAs;
- reviews bounded regular-file changes and rejects credential-shaped content;
- requires immutable SHA or digest pins for every workflow action;
- validates non-automerge Renovate and managed process-adoption contracts;
- never receives consumer secrets or a write token;
- emits retained JSON evidence identifying the verifier commit.

Changes to the verifier are reviewed by the previously pinned verifier revision. This creates a forward trust chain instead of allowing a verifier change to approve itself.

## Branch policy

Steady-state default-branch protection requires:

- pull requests with strict, up-to-date required checks;
- the repository's complete CI surface;
- `independent-review` from the pinned reusable workflow;
- resolved conversations and linear history;
- protection for administrators;
- no force pushes, branch deletion, direct pushes, or broad bypass actor;
- zero required human approvals while only one maintainer exists.

If a second trusted maintainer joins, the governance mode may be changed to `two-person` and one fresh code-owner approval can be added without changing release or adoption automation.

## Residual risk

This model provides independent automated verification, not independent human judgment. It cannot protect against a malicious sole owner, a compromised owner account, or coordinated compromise of GitHub-hosted infrastructure. Hardware-backed account security, short-lived GitHub App tokens, immutable artifacts, OIDC publication, reproducible evidence, and recoverable rollback remain mandatory compensating controls.
