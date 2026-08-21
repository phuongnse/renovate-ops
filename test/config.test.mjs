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

test('global configuration has a closed repository boundary', () => {
  assert.deepEqual(config.repositories, repositories);
  assert.equal(config.autodiscover, false);
  assert.equal(config.onboarding, false);
  assert.equal(config.requireConfig, 'required');
  assert.equal(new Set(repositories).size, repositories.length);
  assert.ok(repositories.every((repository) => /^phuongnse\/[a-z0-9._-]+$/i.test(repository)));
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
  assert.match(workflow, /actions\/create-github-app-token@[a-f0-9]{40}/);
  assert.match(workflow, /repositories: \$\{\{ steps\.allowlist\.outputs\.repositories \}\}/);
  assert.match(workflow, /RENOVATE_APP_CLIENT_ID/);
  assert.match(workflow, /RENOVATE_APP_PRIVATE_KEY/);
  assert.match(workflow, /vars\.RENOVATE_ENABLED == 'true'/);
  assert.doesNotMatch(workflow, /RENOVATE_PAT|PERSONAL_ACCESS_TOKEN/);
});

test('runtime and actions are immutable and Docker socket is unavailable', () => {
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/create-github-app-token@[a-f0-9]{40}/);
  assert.match(workflow, /renovatebot\/github-action@[a-f0-9]{40}/);
  assert.match(workflow, /renovate-version: sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(workflow, /mount-docker-socket:\s*true/);
  assert.match(workflow, /timeout-minutes: 55/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('GitHub App manifest matches the explicit workflow permissions', () => {
  assert.equal(manifest.public, false);
  assert.equal(manifest.hook_attributes.active, false);
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

test('main protection requires CI, independent review, and immutable history', () => {
  assert.match(branchProtection, /contexts: \['validate'\]/);
  assert.match(branchProtection, /enforce_admins: true/);
  assert.match(branchProtection, /dismiss_stale_reviews: true/);
  assert.match(branchProtection, /require_code_owner_reviews: true/);
  assert.match(branchProtection, /required_approving_review_count: 1/);
  assert.match(branchProtection, /require_last_push_approval: true/);
  assert.match(branchProtection, /required_linear_history: true/);
  assert.match(branchProtection, /required_conversation_resolution: true/);
  assert.match(branchProtection, /allow_force_pushes: false/);
  assert.match(branchProtection, /allow_deletions: false/);
  assert.doesNotMatch(branchProtection, /^  restrictions:/m);
});
