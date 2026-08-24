import { spawnSync } from 'node:child_process';

const repository = 'phuongnse/renovate-ops';
const protection = {
  required_status_checks: {
    strict: true,
    contexts: ['validate', 'policy-verification / policy-verification'],
  },
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: true,
  lock_branch: false,
  allow_fork_syncing: false,
};

const result = spawnSync(
  'gh',
  [
    'api',
    '--method',
    'PUT',
    `repos/${repository}/branches/main/protection`,
    '--input',
    '-',
  ],
  {
    encoding: 'utf8',
    input: JSON.stringify(protection),
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    'branch protection failed; verify repository visibility, plan, and owner-compatible settings',
  );
}

process.stdout.write(
  'Protected main with required CI, policy verification, and linear history.\n',
);
