# Repository instructions

This repository is the privileged control plane for dependency automation.

- Keep `repositories.json` as the only repository allowlist.
- Pin every third-party GitHub Action to a full commit SHA and retain its release tag in a comment.
- Pin the Renovate container by OCI digest and retain its version annotation.
- Never add a personal access token, Docker socket mount, shell executor, discovery wildcard, or unreviewed command pattern.
- Treat GitHub App permission changes and `allowedCommands` changes as security-sensitive.
- Treat the reusable policy-verification workflow and verifier as a supplemental
  cross-repository trust root. Consumers must pin it by full commit SHA. It never
  substitutes for the process lifecycle's host-selected semantic review.
- Run `npm run check` before publishing a change.
- Keep production automerge disabled. Consumer adoption remains authorized by merging its reviewed PR.
- Materialize npm locks with `--ignore-scripts`; approve only exact `re2@1.26.1`,
  explicitly deny unrelated install scripts, and verify the native RE2 runtime before
  running either canonical Renovate validator.

<!-- engineering-process:start -->
## Engineering process

Use the portable skills pinned by `.process/process.lock` for every non-trivial
change. Enter through `run-change` and use `processctl change ...` for specification,
planning, implementation registration, checkpoint verification, independent review,
finding resolution, and completion.

The project owns product decisions, domain contracts, exact verification commands,
and publication authority. The process distribution owns lifecycle semantics and
managed skills. Do not edit managed skills in this repository; update the pinned
distribution and synchronize them instead.

Independent review requires an attested read-only actor and context that did not
implement the current cycle. No particular agent host is required. Missing or stale
evidence, self-review, and publication without separate authorization are blocking.
<!-- engineering-process:end -->
