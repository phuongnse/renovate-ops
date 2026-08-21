import { spawnSync } from 'node:child_process';

const policies = {
  'phuongnse/renovate-ops': [
    'validate',
    'independent-review / independent-review',
  ],
  'phuongnse/engineering-process': [
    'independent-review / independent-review',
    'verify (ubuntu-latest, 3.11)',
    'verify (ubuntu-latest, 3.14)',
    'verify (macos-latest, 3.14)',
    'verify (windows-latest, 3.14)',
    'Verify exact Release PR candidate',
  ],
  'phuongnse/axis': [
    'independent-review / independent-review',
    'PR guard',
    'Process contract (ubuntu-latest)',
    'Process contract (windows-latest)',
    'Detect changes',
    'Doc drift',
    'Secret scanning',
    '.NET — Build and Test',
    'Frontend — Type Check, Lint, and Test',
    'Markdown link check',
  ],
  'phuongnse/axis-reference-product': [
    'independent-review / independent-review',
    'Process contract (ubuntu-latest)',
    'Process contract (windows-latest)',
    'Build and test',
  ],
};

function protection(contexts) {
  return {
    required_status_checks: { strict: true, contexts },
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
}
for (const [repository, contexts] of Object.entries(policies)) {
  const result = spawnSync(
    'gh',
    [
      'api',
      '--method',
      'PUT',
      `repos/${repository}/branches/main/protection`,
      '--input',
      '-',
      '--silent',
    ],
    {
      encoding: 'utf8',
      input: JSON.stringify(protection(contexts)),
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`failed to protect ${repository}`);
  }
  process.stdout.write(`Protected ${repository}/main with ${contexts.length} required checks.\n`);
}
