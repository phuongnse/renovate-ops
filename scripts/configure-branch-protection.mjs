import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'phuongnse/renovate-ops';
const currentContexts = ['validate', 'policy-verification / policy-verification'];
const nextContexts = ['Validate operations', 'Policy verification / Shared policy'];

function gh(args, input) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 1_000_000,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function verifiedMigrationContexts(headSha, checks) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('migration head must be a full SHA');
  const successful = new Set(
    checks
      .filter((check) => check.head_sha === headSha
        && check.app?.slug === 'github-actions'
        && check.status === 'completed'
        && check.conclusion === 'success')
      .map((check) => check.name),
  );
  const missing = nextContexts.filter((name) => !successful.has(name));
  if (missing.length > 0) {
    throw new Error(`migration head lacks successful required contexts: ${missing.join(', ')}`);
  }
  return [...nextContexts];
}

function main() {
  const args = process.argv.slice(2);
  let contexts = currentContexts;
  if (args[0] === '--migrate-ci-contexts' && args.length === 2) {
    const headSha = args[1];
    const report = JSON.parse(gh([
      'api',
      `repos/${repository}/commits/${headSha}/check-runs?per_page=100`,
    ]));
    contexts = verifiedMigrationContexts(headSha, report.check_runs);
  } else if (!(args.length === 0 || (args[0] === '--restore-ci-contexts' && args.length === 1))) {
    throw new Error(
      'usage: configure-branch-protection.mjs [--migrate-ci-contexts HEAD_SHA|--restore-ci-contexts]',
    );
  }

  const protection = {
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
  gh(
    ['api', '--method', 'PUT', `repos/${repository}/branches/main/protection`, '--input', '-'],
    JSON.stringify(protection),
  );
  process.stdout.write(`Protected main with required contexts: ${contexts.join(', ')}.\n`);
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) main();
