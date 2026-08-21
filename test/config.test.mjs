import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const config = require('../config.cjs');
const repositories = JSON.parse(await readFile(new URL('repositories.json', root)));
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

test('global configuration has a closed repository boundary', () => {
  assert.deepEqual(config.repositories, repositories);
  assert.equal(config.autodiscover, false);
  assert.equal(config.onboarding, false);
  assert.equal(config.requireConfig, 'required');
  assert.equal(new Set(repositories).size, repositories.length);
  assert.ok(repositories.every((repository) => /^phuongnse\/[a-z0-9._-]+$/i.test(repository)));

  const containerRepositories = JSON.parse(
    execFileSync(
      process.execPath,
      ['-e', 'process.stdout.write(JSON.stringify(require("./config.cjs").repositories))'],
      {
        cwd: new URL('.', root),
        encoding: 'utf8',
        env: { ...process.env, RENOVATE_REPOSITORIES: repositories.join(',') },
      },
    ),
  );
  assert.deepEqual(containerRepositories, repositories);
});

test('only the process adoption command is executable', () => {
  assert.equal(config.allowScripts, false);
  assert.equal(config.allowPlugins, false);
  assert.equal(config.allowShellExecutorForPostUpgradeCommands, false);
  assert.deepEqual(config.allowedCommands, [
    '^python \\.process/adopt-process\\.py --project-root \\. --requirements-lock requirements/process\\.txt$',
  ]);
});

test('workflow scopes a short-lived app token to the same allowlist', () => {
  const output = execFileSync(process.execPath, ['scripts/export-repositories.mjs'], {
    cwd: new URL('.', root),
    encoding: 'utf8',
  });
  for (const repository of repositories) assert.match(output, new RegExp(`${repository}(?:\\n|$)`));
  assert.match(output, new RegExp(`renovate_repositories=${repositories.join(',')}`));
  assert.match(workflow, /actions\/create-github-app-token@[a-f0-9]{40}/);
  assert.match(workflow, /repositories: \$\{\{ steps\.allowlist\.outputs\.repositories \}\}/);
  assert.match(
    workflow,
    /RENOVATE_REPOSITORIES: \$\{\{ steps\.allowlist\.outputs\.renovate_repositories \}\}/,
  );
  assert.match(workflow, /RENOVATE_APP_CLIENT_ID/);
  assert.match(workflow, /RENOVATE_APP_PRIVATE_KEY/);
  assert.match(workflow, /vars\.RENOVATE_ENABLED == 'true'/);
  assert.doesNotMatch(workflow, /RENOVATE_PAT|PERSONAL_ACCESS_TOKEN/);
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
  assert.match(branchProtection, /^  restrictions: null,/m);
  assert.doesNotMatch(branchProtection, /dismissal_restrictions/);
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
