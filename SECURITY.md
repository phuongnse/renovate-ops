# Security policy

Do not report a suspected credential exposure in a public issue. Revoke the GitHub App private key, suspend the app installation, disable the Renovate workflow, and contact the repository owner privately.

The GitHub Actions secret is the only retained copy of the automation private key. Installation tokens are created per run, scoped to `repositories.json`, masked by GitHub Actions, and revoked by the token action after the job.

See `docs/THREAT_MODEL.md` for trust boundaries and `docs/RUNBOOK.md` for response procedures.
