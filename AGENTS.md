# Repository instructions

This repository is the privileged control plane for dependency automation.

- Keep `repositories.json` as the only repository allowlist.
- Pin every third-party GitHub Action to a full commit SHA and retain its release tag in a comment.
- Pin the Renovate container by OCI digest and retain its version annotation.
- Never add a personal access token, Docker socket mount, shell executor, discovery wildcard, or unreviewed command pattern.
- Treat GitHub App permission changes and `allowedCommands` changes as security-sensitive.
- Treat the reusable independent-review workflow and verifier as the cross-repository trust root. Consumers must pin it by full commit SHA.
- Run `npm run check` before publishing a change.
- Keep production automerge disabled. Consumer adoption remains authorized by merging its reviewed PR.
