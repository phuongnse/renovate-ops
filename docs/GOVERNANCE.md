# Single-maintainer governance

## Authorization model

This operations repository and each consumer declare their own governance. A merge
by `phuongnse` is the sole human authorization while no second maintainer exists; the
policy does not manufacture independence by changing Git authorship.

Every default-branch change passes three separate control planes:

1. Before PR publication, the engineering-process lifecycle requires a host-selected
   independent agent or human to semantically review the exact verified checkpoint.
2. Repository-owned build, test, and contract checks verify project behavior.
3. The immutable reusable workflow in this repository publishes a
   `policy-verification` check and bounded static evidence from a clean, read-only
   runner.

PR publication already requires the first control plane to have completed. The merge
button becomes eligible only after both GitHub control planes also pass. Adoption and
release pull requests never automerge.

Consumer membership is never declared here. Each consumer owns explicit Renovate
intent in its protected config, and GitHub App selected-repository installation is
the independent platform authorization.

## Immutable policy verification

Consumers reference `.github/workflows/policy-verification.yml` by a full commit SHA. The called workflow uses GitHub's `job.workflow_repository` and `job.workflow_sha` contexts to check out the verifier implementation co-located with that exact workflow revision. Consumer pull requests cannot select a different verifier after the caller SHA is pinned and protected.

The verifier:

- accepts a syntactically valid `phuongnse/*` caller only when the event repository,
  live pull request, checkout, and immutable head all identify that same caller;
- binds evidence to full base and head commit SHAs;
- reviews bounded regular-file changes and rejects credential-shaped content;
- requires immutable SHA or digest pins for every workflow action;
- validates non-automerge Renovate and process-adoption contracts;
- never receives consumer secrets or a write token;
- emits retained JSON evidence identifying the verifier commit.
- emits no semantic verdict, lifecycle quality assessment, or lifecycle finding.

Changes to the verifier are checked by the previously pinned verifier revision and
semantically reviewed through the normal pre-PR lifecycle. This creates a forward
static trust chain without allowing the policy verifier to approve itself.

Repository CI prepares validator dependencies under a separate locked boundary:
`npm ci --ignore-scripts` materializes packages, the exact `allowScripts` policy
permits only `re2@1.26.1`, process setup rebuilds only that package, and a read-only
probe proves the regular native module and working import. Missing native RE2 or any
unreviewed install-script entry blocks validation; output suppression and the
inaccurate RegExp fallback are not accepted evidence.

## Branch policy

Each repository owns and applies its own default-branch protection. Steady state requires:

- pull requests with strict, up-to-date required checks;
- the repository's complete CI surface;
- `policy-verification` from the pinned reusable workflow;
- resolved conversations and linear history;
- protection for administrators;
- no force pushes, branch deletion, direct pushes, or broad bypass actor;
- zero required human approvals while only one maintainer exists.

`renovate-ops` configures only its own branch. It does not keep or apply a central
map of consumer check names. If a second trusted maintainer joins, a consumer may
independently change its governance mode and require a fresh code-owner approval.

## Residual risk

Policy verification is deterministic static evidence, not semantic review or
independent human judgment. Semantic independence is supplied by the lifecycle host
before publication. Neither control can protect against a malicious sole owner, a
compromised owner account, or coordinated compromise of GitHub-hosted infrastructure.
Hardware-backed account security, short-lived GitHub App tokens, immutable artifacts,
OIDC publication, reproducible evidence, and recoverable rollback remain mandatory
compensating controls.
