import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'phuongnse/renovate-ops';
const legacyContexts = ['validate', 'policy-verification / policy-verification'];
const currentContexts = ['Validate operations', 'Policy verification / Shared policy'];
const statusChecksPath = `repos/${repository}/branches/main/protection/required_status_checks`;

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

export function assertMigrationArguments(pullRequestNumber, headSha) {
  if (!/^[1-9][0-9]*$/.test(pullRequestNumber)
    || !Number.isSafeInteger(Number(pullRequestNumber))) {
    throw new Error('migration pull request number must be a positive integer');
  }
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error('migration head must be a full SHA');
}

export function assertLivePullRequest(pullRequest, pullRequestNumber, headSha) {
  if (
    pullRequest.number !== Number(pullRequestNumber)
    || pullRequest.state !== 'open'
    || pullRequest.base?.ref !== 'main'
    || pullRequest.base?.repo?.full_name?.toLowerCase() !== repository
    || pullRequest.head?.repo?.full_name?.toLowerCase() !== repository
    || pullRequest.head?.sha !== headSha
  ) {
    throw new Error('migration target must be the current head of an open same-repository PR to main');
  }
}

export function verifiedMigrationChecks(headSha, contextNames, checks) {
  if (!Array.isArray(checks)) throw new Error('check-runs response must contain an array');
  const required = contextNames.map((name) => checks.find((check) =>
    check.name === name
    && check.head_sha === headSha
    && check.app?.slug === 'github-actions'
    && Number.isSafeInteger(check.app.id)
    && check.app.id > 0
    && check.status === 'completed'
    && check.conclusion === 'success'));
  const missing = contextNames.filter((_, index) => !required[index]);
  if (missing.length > 0) {
    throw new Error(`migration head lacks successful required contexts: ${missing.join(', ')}`);
  }
  return required.map((check) => ({ context: check.name, app_id: check.app.id }));
}

export function replaceRequiredChecks(current, sourceNames, targetChecks) {
  if (current?.strict !== true || !Array.isArray(current.checks)) {
    throw new Error('current required status checks must be strict and expose check identities');
  }
  const source = new Set(sourceNames);
  const target = new Set(targetChecks.map(({ context }) => context));
  const sourcePresent = sourceNames.every((name) =>
    current.checks.some((check) => check.context === name));
  const targetPresent = targetChecks.every(({ context, app_id: appId }) =>
    current.checks.some((check) => check.context === context && check.app_id === appId));
  const hasSource = current.checks.some((check) => source.has(check.context));
  const hasTarget = current.checks.some((check) => target.has(check.context));
  if (!((sourcePresent && !hasTarget) || (!hasSource && targetPresent))) {
    throw new Error('required status checks are not in one complete migration state');
  }
  const unrelated = current.checks.filter((check) =>
    !source.has(check.context) && !target.has(check.context));
  return { strict: true, checks: [...unrelated, ...targetChecks] };
}

function configureAll(contexts) {
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
}

function migrate(mode, pullRequestNumber, headSha) {
  assertMigrationArguments(pullRequestNumber, headSha);
  const pullRequest = JSON.parse(gh([
    'api',
    `repos/${repository}/pulls/${pullRequestNumber}`,
  ]));
  assertLivePullRequest(pullRequest, pullRequestNumber, headSha);
  const targetNames = mode === '--migrate-ci-contexts' ? currentContexts : legacyContexts;
  const sourceNames = mode === '--migrate-ci-contexts' ? legacyContexts : currentContexts;
  const checkRuns = JSON.parse(gh([
    'api',
    `repos/${repository}/commits/${headSha}/check-runs?per_page=100`,
  ])).check_runs;
  const targetChecks = verifiedMigrationChecks(headSha, targetNames, checkRuns);
  const current = JSON.parse(gh(['api', statusChecksPath]));
  const update = replaceRequiredChecks(current, sourceNames, targetChecks);
  assertLivePullRequest(
    JSON.parse(gh(['api', `repos/${repository}/pulls/${pullRequestNumber}`])),
    pullRequestNumber,
    headSha,
  );
  gh(
    ['api', '--method', 'PATCH', statusChecksPath, '--input', '-'],
    JSON.stringify(update),
  );
  process.stdout.write(`Migrated required contexts for PR #${pullRequestNumber} at ${headSha}.\n`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) configureAll(currentContexts);
  else if (
    args.length === 3
    && ['--migrate-ci-contexts', '--restore-ci-contexts'].includes(args[0])
  ) migrate(...args);
  else {
    throw new Error(
      'usage: configure-branch-protection.mjs [--migrate-ci-contexts|--restore-ci-contexts] PR_NUMBER HEAD_SHA',
    );
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) main();
