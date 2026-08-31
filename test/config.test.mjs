import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import config from '../config.cjs';

const root = new URL('../', import.meta.url);
const renovateConfig = JSON.parse(
  await readFile(new URL('.github/renovate.json5', root)),
);
const packageDocument = JSON.parse(await readFile(new URL('package.json', root)));
const processManifest = JSON.parse(await readFile(new URL('.process/project.json', root)));
const processRequirements = await readFile(new URL('requirements/process.txt', root), 'utf8');
const npmConfig = await readFile(new URL('.npmrc', root), 'utf8');
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
const policyWorkflow = await readFile(
  new URL('.github/workflows/policy-verification.yml', root),
  'utf8',
);
const ciWorkflow = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8');
const readme = await readFile(new URL('README.md', root), 'utf8');
const runbook = await readFile(new URL('docs/RUNBOOK.md', root), 'utf8');
const validationRuntime = await readFile(
  new URL('scripts/verify-validation-runtime.mjs', root),
  'utf8',
);
const canonicalPipCompileCommand =
  'pip-compile --generate-hashes --no-emit-index-url --output-file=requirements/process.txt --strip-extras requirements/process.in';

test('validation dependency scripts are exact, denied by default, and setup-owned', () => {
  assert.deepEqual(packageDocument.allowScripts, {
    'core-js-pure': false,
    'dtrace-provider': false,
    're2@1.26.1': true,
  });
  assert.equal(npmConfig, 'strict-allow-scripts=true\n');
  assert.equal(processManifest.schemaVersion, 5);
  assert.equal(Object.hasOwn(processManifest, 'environment'), false);
  const processHeader = processRequirements.split('\n').slice(0, 7).join('\n');
  assert.match(
    processHeader,
    /pip-compile --generate-hashes --no-emit-index-url --output-file=requirements\/process\.txt --strip-extras requirements\/process\.in/,
  );
  assert.doesNotMatch(processHeader, /--no-index/);
  const action = processManifest.setup.find(
    ({ id }) => id === 'prepare-validation-runtime',
  );
  assert.deepEqual(action.run, ['npm', 'rebuild', 're2']);
  assert.equal(action.timeoutSeconds, 300);
  assert.match(validationRuntime, /node_modules\/re2\/build\/Release\/re2\.node/);
  assert.doesNotMatch(validationRuntime, /RENOVATE_X_IGNORE_RE2/);

  const install = ciWorkflow.indexOf('run: npm ci --ignore-scripts');
  const setup = ciWorkflow.indexOf('processctl setup');
  const profiles = ciWorkflow.indexOf('processctl verify --project-root . --profile development');
  assert.ok(install >= 0 && install < setup && setup < profiles);
});

test('global configuration requires one workflow-supplied target', () => {
  assert.equal(Object.hasOwn(config, 'repositories'), false);
  assert.equal(config.autodiscover, false);
  assert.equal(config.onboarding, false);
  assert.equal(config.requireConfig, 'required');
  assert.deepEqual(config.constraints, { pipTools: '==7.6.1' });
  assert.deepEqual(config.customEnvVariables, {
    CUSTOM_COMPILE_COMMAND: canonicalPipCompileCommand,
  });
  assert.equal(config.exposeAllEnv, undefined);
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

test('only the exact non-shell process adoption command is allowed', () => {
  assert.equal(config.allowScripts, false);
  assert.equal(config.allowPlugins, false);
  assert.equal(config.allowShellExecutorForPostUpgradeCommands, false);
  assert.deepEqual(config.allowedCommands, [
    '^python \\.process/adopt-process\\.py --project-root \\. --requirements-lock requirements/process\\.txt$',
  ]);
  assert.equal(renovateConfig.enabled, true);
  assert.equal(renovateConfig.draftPR, true);
  assert.equal(Object.hasOwn(renovateConfig, 'postUpgradeTasks'), false);
  const authorityRule = renovateConfig.packageRules.find((rule) =>
    rule.matchPackageNames?.includes('engineering-process')
  );
  assert.ok(authorityRule);
  assert.equal(authorityRule.enabled, true);
  assert.equal(authorityRule.draftPR, true);
  assert.deepEqual(authorityRule.postUpgradeTasks.commands, [
    'python .process/adopt-process.py --project-root . --requirements-lock requirements/process.txt',
  ]);
  assert.equal(authorityRule.postUpgradeTasks.executionMode, 'update');
  assert.match(ciWorkflow, /automation\/renovate\/engineering-process/);
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
  const childCompileCommand = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const { default: config } = await import("./config.cjs"); '
        + 'const { setCustomEnv } = await import("./node_modules/renovate/dist/util/env.js"); '
        + 'const { getChildEnv } = await import("./node_modules/renovate/dist/util/exec/utils.js"); '
        + 'setCustomEnv(config.customEnvVariables); '
        + 'process.stdout.write(getChildEnv().CUSTOM_COMPILE_COMMAND ?? "");',
    ],
    { cwd: new URL('.', root), encoding: 'utf8' },
  );
  assert.equal(childCompileCommand, canonicalPipCompileCommand);
  assert.match(workflow, /name: Revalidate consumer intent before execution/);
  assert.match(workflow, /name: Revalidate consumer intent after execution/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
  assert.doesNotMatch(workflow, /finalize-adoption-prs|markPullRequestReadyForReview/);
  assert.match(workflow, /token: \$\{\{ steps\.app-token\.outputs\.token \}\}/);
});

test('process adoption is materialized before independent merge review', () => {
  for (const document of [readme, runbook]) {
    assert.match(document, /managed adoption command/i);
    assert.match(document, /draft.*before.*merge/is);
    assert.doesNotMatch(document, /bot-owned/i);
  }
});

test('superseded CI semantic-review and adoption-finalizer sources are absent', async () => {
  for (const path of [
    '.github/workflows/independent-review.yml',
    'scripts/finalize-adoption-prs.mjs',
    'scripts/independent-review.mjs',
  ]) {
    await assert.rejects(readFile(new URL(path, root)), { code: 'ENOENT' });
  }
});

test('trust-root rotation retains proof-before-cutover and restoration guidance', () => {
  assert.match(runbook, /pin self-CI to that exact main commit/i);
  assert.match(runbook, /Restore the old context if cutover cannot complete/i);
  assert.match(runbook, /Retire the old caller and workflow only after the new context is active/i);
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

test('main protection requires CI, policy verification, and immutable history', () => {
  assert.match(
    branchProtection,
    /contexts: \['validate', 'policy-verification \/ policy-verification'\]/,
  );
  assert.match(branchProtection, /enforce_admins: true/);
  assert.match(branchProtection, /required_pull_request_reviews: null/);
  assert.match(branchProtection, /required_linear_history: true/);
  assert.match(branchProtection, /required_conversation_resolution: true/);
  assert.match(branchProtection, /allow_force_pushes: false/);
  assert.match(branchProtection, /allow_deletions: false/);
});

test('policy verification resolves verifier code from the exact Stage A main SHA', () => {
  assert.match(policyWorkflow, /permissions:\n  contents: read/);
  assert.match(policyWorkflow, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(policyWorkflow, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(policyWorkflow, /TRUSTED_WORKFLOW_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.doesNotMatch(policyWorkflow, /pull_request_target|secrets:\s*inherit/);
  assert.match(
    ciWorkflow,
    /uses: phuongnse\/renovate-ops\/\.github\/workflows\/policy-verification\.yml@5fb53c2295c0f62c29d34c8141121b71198769f4/,
  );
  assert.match(
    ciWorkflow,
    /policy-verification:\n    name: policy-verification\n    if: github\.event_name == 'pull_request'\n    permissions:\n      contents: read\n      pull-requests: read\n    uses: phuongnse\/renovate-ops\/\.github\/workflows\/policy-verification\.yml@5fb53c2295c0f62c29d34c8141121b71198769f4/,
  );
  assert.doesNotMatch(ciWorkflow, /pull-requests: write/);
  assert.doesNotMatch(ciWorkflow, /secrets:\s*inherit/);
  assert.doesNotMatch(ciWorkflow, /independent-review/);
});

test('consumer branch protections are not centrally declared', async () => {
  assert.equal(Object.hasOwn(packageDocument.scripts, 'bootstrap:protect-all'), false);
  await assert.rejects(
    () => readFile(new URL('scripts/configure-repository-protections.mjs', root)),
    (error) => error.code === 'ENOENT',
  );
});

test('event-driven policy verification binds inputs to the live pull request', () => {
  assert.match(policyWorkflow, /target_pr_number:/);
  assert.match(policyWorkflow, /target_head_sha:/);
  assert.match(policyWorkflow, /repos\/\$GITHUB_REPOSITORY\/pulls\/\$REQUESTED_PR_NUMBER/);
  assert.match(policyWorkflow, /\.head\.sha[^\n]+REQUESTED_HEAD_SHA/);
  assert.match(policyWorkflow, /--event-path "\$\{\{ steps\.target\.outputs\.event_path \}\}"/);
  assert.doesNotMatch(policyWorkflow, /GITHUB_EVENT_PATH: \$\{\{ steps\.target\.outputs\.event_path \}\}/);
  assert.doesNotMatch(policyWorkflow, /\bschedule:|workflow_dispatch:/);
});
