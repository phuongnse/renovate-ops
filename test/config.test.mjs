import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import config from '../config.cjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('github-app-manifest.json', root)));
const workflow = await readFile(new URL('.github/workflows/renovate.yml', root), 'utf8');
const branchProtection = await readFile(
  new URL('scripts/configure-branch-protection.mjs', root),
  'utf8',
);
const manifestServer = await readFile(
  new URL('scripts/github-app-manifest-server.mjs', root),
  'utf8',
);
const independentWorkflow = await readFile(
  new URL('.github/workflows/independent-review.yml', root),
  'utf8',
);
const ciWorkflow = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8');
const packageDocument = JSON.parse(await readFile(new URL('package.json', root)));
const readme = await readFile(new URL('README.md', root), 'utf8');
const runbook = await readFile(new URL('docs/RUNBOOK.md', root), 'utf8');

test('global configuration requires one workflow-supplied target', () => {
  assert.equal(Object.hasOwn(config, 'repositories'), false);
  assert.equal(config.autodiscover, false);
  assert.equal(config.onboarding, false);
  assert.equal(config.requireConfig, 'required');
  assert.match(workflow, /OPS_TARGET_REPOSITORY: \$\{\{ matrix\.repository \}\}/);
  assert.doesNotMatch(workflow, /repositories\.json|steps\.allowlist/);

  const repositories = JSON.parse(execFileSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require("./config.cjs").repositories))'],
    {
      cwd: new URL('.', root),
      encoding: 'utf8',
      env: { ...process.env, OPS_TARGET_REPOSITORY: 'phuongnse/axis' },
    },
  ));
  assert.deepEqual(repositories, ['phuongnse/axis']);
  const invalid = spawnSync(
    process.execPath,
    ['-e', 'require("./config.cjs")'],
    {
      cwd: new URL('.', root),
      encoding: 'utf8',
      env: { ...process.env, OPS_TARGET_REPOSITORY: 'phuongnse/axis,phuongnse/other' },
    },
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /one exact trusted repository/);
});

test('only the process adoption command is executable', () => {
  assert.equal(config.allowScripts, false);
  assert.equal(config.allowPlugins, false);
  assert.equal(config.allowShellExecutorForPostUpgradeCommands, false);
  assert.deepEqual(config.allowedCommands, [
    '^python \\.process/adopt-process\\.py --project-root \\. --requirements-lock requirements/process\\.txt$',
  ]);
});

test('workflow separates read-only discovery from repository-scoped writers', () => {
  assert.match(workflow, /name: Create read-only installation discovery token/);
  assert.match(workflow, /permission-contents: read/);
  assert.match(workflow, /name: Create one repository-scoped GitHub App token/);
  assert.match(workflow, /repositories: \$\{\{ matrix\.repository \}\}/);
  assert.match(workflow, /max-parallel: 4/);
  assert.match(workflow, /node scripts\/discover-consumers\.mjs/);
  assert.match(workflow, /node scripts\/validate-consumer-manifest\.mjs/);
  assert.equal((workflow.match(/actions\/create-github-app-token@[a-f0-9]{40}/g) ?? []).length, 2);
  assert.match(workflow, /RENOVATE_APP_CLIENT_ID/);
  assert.match(workflow, /RENOVATE_APP_PRIVATE_KEY/);
  assert.match(workflow, /vars\.RENOVATE_ENABLED == 'true'/);
  assert.doesNotMatch(workflow, /RENOVATE_PAT|PERSONAL_ACCESS_TOKEN/);
});

test('production Renovate is activated by a bounded authenticated release event', () => {
  assert.match(workflow, /repository_dispatch:\n    types: \[engineering-process-published\]/);
  assert.doesNotMatch(workflow, /^  schedule:/m);
  assert.match(workflow, /node scripts\/validate-release-event\.mjs "\$GITHUB_EVENT_PATH"/);
  assert.match(workflow, /RENOVATE_ATTEMPT_ONE_LOG: \/tmp\/renovate-production-attempt-1\.ndjson/);
  assert.match(workflow, /RENOVATE_ATTEMPT_TWO_LOG: \/tmp\/renovate-production-attempt-2\.ndjson/);
  assert.match(workflow, /"\$RENOVATE_ATTEMPT_ONE_LOG" "\$RENOVATE_CONSUMER_MANIFEST"/);
  assert.match(workflow, /node scripts\/wait-for-renovate-retry\.mjs/);
  assert.match(workflow, /"\$RENOVATE_ATTEMPT_TWO_LOG" "\$RENOVATE_CONSUMER_MANIFEST"/);
  assert.equal((workflow.match(/name: Renovate production attempt [12]/g) ?? []).length, 2);
  assert.match(workflow, /name: Revalidate consumer intent before execution/);
  assert.match(workflow, /name: Revalidate consumer intent after execution/);
  assert.match(
    workflow,
    /steps\.production_attempt_one\.outputs\.status == 'passed' \|\|\n\s+steps\.production_attempt_two\.outcome == 'success'/,
  );
  assert.match(workflow, /"\$GITHUB_EVENT_PATH" "\$RENOVATE_CONSUMER_MANIFEST"/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
});

test('consumer intent and bot-owned adoption branch remain explicit', () => {
  for (const document of [readme, runbook]) {
    assert.match(document, /enabled/i);
    assert.match(document, /automation\/renovate\/engineering-process-authority/);
    assert.match(document, /bot-owned/i);
    assert.match(document, /normal reviewed\s+branch/i);
  }
});

test('runtime and actions are immutable and Docker socket is unavailable', () => {
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/create-github-app-token@[a-f0-9]{40}/);
  assert.match(workflow, /renovatebot\/github-action@[a-f0-9]{40}/);
  assert.match(workflow, /renovate-version: \d+\.\d+\.\d+@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(workflow, /mount-docker-socket:\s*true/);
  assert.match(workflow, /timeout-minutes: 55/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('GitHub App manifest matches the explicit workflow permissions', () => {
  assert.equal(manifest.public, false);
  assert.equal(manifest.hook_attributes.active, false);
  assert.equal(manifest.hook_attributes.url, 'https://github.com/phuongnse/renovate-ops');
  assert.deepEqual(manifest.default_events, []);
  assert.deepEqual(manifest.default_permissions, {
    administration: 'read',
    checks: 'write',
    contents: 'write',
    issues: 'write',
    members: 'read',
    metadata: 'read',
    pull_requests: 'write',
    statuses: 'write',
    vulnerability_alerts: 'read',
    workflows: 'write',
  });
});

test('manifest bootstrap binds the callback to an unguessable state', () => {
  assert.match(manifestServer, /randomBytes\(32\)/);
  assert.match(manifestServer, /timingSafeEqual/);
  assert.match(manifestServer, /settings\/apps\/new\?state=\$\{state\}/);
  assert.match(manifestServer, /hasValidState\(url\.searchParams\.get\('state'\)\)/);
});

test('main protection requires CI, independent review, and immutable history', () => {
  assert.match(
    branchProtection,
    /contexts: \['validate', 'independent-review \/ independent-review'\]/,
  );
  assert.match(branchProtection, /enforce_admins: true/);
  assert.match(branchProtection, /required_pull_request_reviews: null/);
  assert.match(branchProtection, /required_linear_history: true/);
  assert.match(branchProtection, /required_conversation_resolution: true/);
  assert.match(branchProtection, /allow_force_pushes: false/);
  assert.match(branchProtection, /allow_deletions: false/);
});

test('independent review resolves verifier code from the called workflow SHA', () => {
  assert.match(independentWorkflow, /permissions:\n  contents: read/);
  assert.match(independentWorkflow, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(independentWorkflow, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(independentWorkflow, /TRUSTED_WORKFLOW_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.doesNotMatch(independentWorkflow, /pull_request_target|secrets:\s*inherit/);
  assert.match(
    ciWorkflow,
    /uses: phuongnse\/renovate-ops\/\.github\/workflows\/independent-review\.yml@[0-9a-f]{40}/,
  );
});

test('consumer branch protections are not centrally declared', async () => {
  assert.equal(Object.hasOwn(packageDocument.scripts, 'bootstrap:protect-all'), false);
  await assert.rejects(
    () => readFile(new URL('scripts/configure-repository-protections.mjs', root)),
    (error) => error.code === 'ENOENT',
  );
});

test('event-driven review binds dispatch inputs to the live pull request', () => {
  assert.match(independentWorkflow, /reviewed_pr_number:/);
  assert.match(independentWorkflow, /reviewed_head_sha:/);
  assert.match(independentWorkflow, /repos\/\$GITHUB_REPOSITORY\/pulls\/\$REQUESTED_PR_NUMBER/);
  assert.match(independentWorkflow, /\.head\.sha[^\n]+REQUESTED_HEAD_SHA/);
  assert.match(independentWorkflow, /--event-path "\$\{\{ steps\.review\.outputs\.event_path \}\}"/);
  assert.doesNotMatch(independentWorkflow, /GITHUB_EVENT_PATH: \$\{\{ steps\.review\.outputs\.event_path \}\}/);
});
