# Single-maintainer governance

## Authorization model

This operations repository and each consumer declare their own governance. A merge
by `phuongnse` is the sole human authorization while no second maintainer exists; the
policy does not manufacture independence by changing Git authorship.

Every default-branch change passes three separate control planes:

1. Before merge, the engineering-process lifecycle requires an independent agent or
   human to semantically review the exact verified checkpoint.
2. Repository-owned build, test, and contract checks verify project behavior.
3. The immutable reusable workflow in this repository publishes a
   `policy-verification` check and bounded static evidence from a clean, read-only
   runner.

The merge button becomes eligible only after lifecycle review and both GitHub control
planes pass. Adoption and release pull requests remain drafts until the owner
authorizes merge.

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
- requires every workflow and job to declare an explicit sentence-case display name;
- requires matrix values in one final parenthesized suffix and the shared-policy
  caller name `Policy verification`;
- validates draft, owner-authorized Renovate and process-adoption contracts;
- never receives consumer secrets or a write token;
- emits retained JSON evidence identifying the verifier commit.
- emits no semantic verdict, lifecycle quality assessment, or lifecycle finding.

Changes to the verifier are checked by the previously pinned verifier revision and
semantically reviewed through the normal lifecycle. This creates a forward
static trust chain without allowing the policy verifier to approve itself.

For this deterministic contract, sentence case means an ASCII uppercase first
letter; established acronyms and proper names remain valid. A matrix job uses
`Base (${{ matrix.axis }})` or `Base (${{ matrix.axis }}, Label ${{ matrix.other }})`.
The reusable job is named `Shared policy`, distinct from its required caller, so the
published context is `Policy verification / Shared policy`.

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
- `Policy verification / Shared policy` from the pinned reusable workflow;
- resolved conversations and linear history;
- protection for administrators;
- no force pushes, branch deletion, direct pushes, or broad bypass actor;
- zero required human approvals while only one maintainer exists.

`renovate-ops` configures only its own branch. It does not keep or apply a central
map of consumer check names. If a second trusted maintainer joins, a consumer may
independently change its governance mode and require a fresh code-owner approval.

## Production readiness

`.process/readiness.json` selects immutable pack `operations@1` at production stage.
Its evidence is
consumer-owned and resolves only through the required development and review profiles:

| Capability | Existing control evidence |
| --- | --- |
| `auditability` | Immutable policy report, bounded per-attempt logs, and reconciled incident issues. |
| `automation-correctness` | Complete Node test suite plus both canonical strict Renovate validators. |
| `bounded-execution` | Workflow timeouts/concurrency, bounded discovery and manifests, one classified retry, and fail-closed logs. |
| `least-privilege` | Read-only discovery token, one repository-scoped write token, disabled shell/plugins/scripts, and exact command allowlist. |
| `policy-integrity` | Immutable action/verifier pins, protected consumer intent, and static policy verification. |
| `recovery` | Classified retry, incident reconciliation, emergency stop, key rotation, and source rollback procedures. |
| `target-selection-integrity` | App-installation intersection, explicit consumer intent, immutable config digest, and pre/post execution revalidation. |

The sidecar remains intentionally separate from the strict schema-v5 project manifest.
The adopted published authority resolves it through `project validate` and `doctor`,
while a consumer-owned Node test locks the exact mapping to the repository checks.
The pack certifies this dependency-automation control-plane boundary; it does not
claim application deployment, service SLO, or product runtime coverage.

Process adoption never upgrades the selected pack version. A later `operations@2`
may be offered by a new process release while this repository continues to validate
against `operations@1`; moving standards is a separate owner-authorized readiness
change. This prevents a new pack requirement from deadlocking authority adoption.

## Residual risk

Policy verification is deterministic static evidence, not semantic review or
independent human judgment. Semantic independence is supplied before merge. Neither
control can protect against a malicious sole owner, a
compromised owner account, or coordinated compromise of GitHub-hosted infrastructure.
Hardware-backed account security, short-lived GitHub App tokens, immutable artifacts,
OIDC publication, reproducible evidence, and recoverable rollback remain mandatory
compensating controls.
