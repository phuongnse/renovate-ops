# Security policy

Do not report a suspected credential exposure in a public issue. Revoke the GitHub App private key, suspend the app installation, disable the Renovate workflow, and contact the repository owner privately.

The GitHub Actions secret is the only retained copy of the automation private key.
One read-only token performs bounded App-installation discovery; every Renovate job
receives a separate token scoped to exactly one explicitly enabled consumer. Tokens
are masked by GitHub Actions and revoked by the token action after each job.

See `docs/THREAT_MODEL.md` for trust boundaries and `docs/RUNBOOK.md` for response procedures.
