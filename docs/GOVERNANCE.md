# Single-maintainer governance

## Authorization model

This operations repository and each consumer declare their own governance. A merge
by `phuongnse` is the sole human authorization while no second maintainer exists; the
policy does not manufacture independence by changing Git authorship.

Every default-branch change still uses a pull request and two separate control planes:

1. Repository-owned build, test, and contract checks verify project behavior.
2. The immutable reusable workflow publishes bounded independent-review evidence
   from a clean, read-only runner.

Consumer membership is never declared here. Each consumer owns explicit Renovate
intent in its protected config, and GitHub App selected-repository installation is
the independent platform authorization.

## Independent automated verification

Consumers reference `.github/workflows/independent-review.yml` by a full commit SHA.
The called workflow uses GitHub's `job.workflow_repository` and `job.workflow_sha`
contexts to check out the verifier co-located with that exact revision.

The verifier:

- requires a pull request targeting `main` and binds the caller repository to the
  event repository without a central consumer registry;
- binds evidence to full base and head commit SHAs;
- reviews bounded regular-file changes and rejects credential-shaped content;
- requires immutable SHA or digest pins for every workflow action;
- validates non-automerge Renovate and process-adoption contracts;
- never receives consumer secrets or a write token;
- emits retained JSON evidence identifying the verifier commit.

Changes to the verifier are reviewed by the previously pinned verifier revision. A
new consumer pin may advance only after that producer checkpoint is published.

## Branch policy

Each repository owns and applies its own default-branch protection. Steady state requires:

- pull requests with strict, up-to-date required checks;
- the repository's complete CI surface;
- independent review from the pinned reusable workflow;
- resolved conversations and linear history;
- protection for administrators;
- no force pushes, branch deletion, direct pushes, or broad bypass actor;
- zero required human approvals while only one maintainer exists.

`renovate-ops` configures only its own branch. It does not keep or apply a central
map of consumer check names. If a second trusted maintainer joins, a consumer may
independently change its governance mode and require a fresh code-owner approval.

## Residual risk

This model provides independent automated verification, not independent human
judgment. It cannot protect against a malicious sole owner, a compromised owner
account, or coordinated compromise of GitHub-hosted infrastructure. Hardware-backed
account security, short-lived repository-scoped tokens, immutable artifacts, OIDC
publication, reproducible evidence, and recoverable rollback remain compensating controls.
