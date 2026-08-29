import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADOPTION_ALLOWED_COMMAND,
  ADOPTION_COMMAND,
  ADOPTION_FILE_FILTERS,
} from '../scripts/process-adoption-contract.mjs';

const verifier = fileURLToPath(new URL('../scripts/policy-verification.mjs', import.meta.url));
const checkoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'renovate-policy-verification-'));
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    `name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${checkoutSha}\n`,
  );
  await writeFile(
    path.join(root, '.github', 'renovate.json5'),
    `${JSON.stringify(
      {
        automerge: false,
        branchPrefix: 'automation/renovate/',
        draftPR: false,
        packageRules: [{ automerge: false }],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, 'README.md'), 'base\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'review-test@example.invalid');
  git(root, 'config', 'user.name', 'Policy Verification Test');
  git(root, 'add', '--', '.github', 'README.md');
  git(root, 'commit', '-qm', 'chore: initialize fixture');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'switch', '-qc', 'feature');
  await writeFile(path.join(root, 'README.md'), 'reviewed\n');
  git(root, 'add', '--', 'README.md');
  git(root, 'commit', '-qm', 'docs: update fixture');
  const headSha = git(root, 'rev-parse', 'HEAD');
  return { root, baseSha, headSha };
}

async function eventFile(
  root,
  baseSha,
  headSha,
  repository = 'phuongnse/axis-reference-product',
) {
  const eventPath = path.join(root, 'event.json');
  await writeFile(
    eventPath,
    `${JSON.stringify({
      repository: { full_name: repository },
      pull_request: {
        number: 7,
        base: { ref: 'main', sha: baseSha },
        head: { ref: 'feature', sha: headSha },
      },
    })}\n`,
  );
  return eventPath;
}

function runVerifier(
  root,
  eventPath,
  outputPath,
  repository = 'phuongnse/axis-reference-product',
) {
  return spawnSync(
    process.execPath,
    [
      verifier,
      '--project-root',
      root,
      '--event-path',
      eventPath,
      '--output',
      outputPath,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: path.join(root, 'ignored-default-event.json'),
        GITHUB_REPOSITORY: repository,
        TRUSTED_WORKFLOW_REPOSITORY: 'phuongnse/renovate-ops',
        TRUSTED_WORKFLOW_SHA: 'a'.repeat(40),
      },
    },
  );
}

async function prepareOperationsConsumer(root, adoptionState, allowlistState) {
  const configPath = path.join(root, '.github', 'renovate.json5');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.packageRules = adoptionState === 'active'
    ? [{
        automerge: false,
        enabled: true,
        matchFileNames: ['requirements/process.in', 'requirements/process.txt'],
        matchPackageNames: ['engineering-process'],
        postUpgradeTasks: {
          commands: [ADOPTION_COMMAND],
          executionMode: 'update',
          fileFilters: ADOPTION_FILE_FILTERS,
          installTools: { python: {} },
        },
      }]
    : [{
        automerge: false,
        enabled: false,
        matchPackageNames: ['engineering-process', 'phuongnse/engineering-process'],
      }];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(root, 'requirements'), { recursive: true });
  await writeFile(
    path.join(root, 'requirements', 'process.in'),
    'engineering-process==0.4.0\n',
  );
  await writeFile(
    path.join(root, 'requirements', 'process.txt'),
    `engineering-process==0.4.0 \\\n    --hash=sha256:${'a'.repeat(64)}\n`,
  );
  const rawCommand = ADOPTION_ALLOWED_COMMAND.replaceAll('\\', '\\\\');
  const allowedCommands = allowlistState === 'active'
    ? `[\n    '${rawCommand}',\n  ]`
    : '[]';
  await writeFile(
    path.join(root, 'config.cjs'),
    `'use strict';\nmodule.exports = {\n  autodiscover: false,\n  allowScripts: false,\n  allowPlugins: false,\n  allowShellExecutorForPostUpgradeCommands: false,\n  allowedCommands: ${allowedCommands},\n};\n`,
  );
  await writeFile(
    path.join(root, '.github', 'workflows', 'renovate.yml'),
    'name: Renovate\non: workflow_dispatch\n',
  );
}

test('policy verifier uses the explicit immutable event path without a semantic verdict', async () => {
  const { root, baseSha, headSha } = await fixture();
  const eventPath = await eventFile(root, baseSha, headSha);
  const outputPath = path.join(root, 'evidence', 'report.json');

  const result = runVerifier(root, eventPath, outputPath);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.governanceMode, 'single-maintainer');
  assert.equal(report.verificationKind, 'policy-verification');
  assert.equal(Object.hasOwn(report, 'verdict'), false);
  assert.equal(Object.hasOwn(report, 'quality'), false);
  assert.equal(Object.hasOwn(report, 'findings'), false);
  assert.equal(report.repository, 'phuongnse/axis-reference-product');
  assert.equal(report.baseSha, baseSha);
  assert.equal(report.headSha, headSha);
  assert.deepEqual(report.changedFileCount, 1);
});

test('policy verifier rejects a mutable action reference', async () => {
  const { root, baseSha } = await fixture();
  await writeFile(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    'name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@main\n',
  );
  git(root, 'add', '--', '.github/workflows/ci.yml');
  git(root, 'commit', '-qm', 'ci: use mutable action');
  const headSha = git(root, 'rev-parse', 'HEAD');
  const eventPath = await eventFile(root, baseSha, headSha);

  const result = runVerifier(root, eventPath, path.join(root, 'report.json'));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /workflow action is not immutably pinned/);
});

test('policy verifier rejects an event for a different caller repository', async () => {
  const { root, baseSha, headSha } = await fixture();
  const eventPath = await eventFile(root, baseSha, headSha);
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  event.repository.full_name = 'phuongnse/different-repository';
  await writeFile(eventPath, `${JSON.stringify(event)}\n`);

  const result = runVerifier(root, eventPath, path.join(root, 'report.json'));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /event repository does not match the caller/);
});

test('operations verifier accepts the legacy-disabled bridge state', async () => {
  const { root, baseSha } = await fixture();
  const configPath = path.join(root, '.github', 'renovate.json5');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.packageRules = [{
    automerge: false,
    enabled: false,
    matchPackageNames: ['engineering-process', 'phuongnse/engineering-process'],
  }];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(root, 'requirements'), { recursive: true });
  await writeFile(
    path.join(root, 'requirements', 'process.in'),
    'engineering-process==0.4.0\n',
  );
  await writeFile(
    path.join(root, 'requirements', 'process.txt'),
    `engineering-process==0.4.0 \\\n    --hash=sha256:${'a'.repeat(64)}\n`,
  );
  await prepareOperationsConsumer(root, 'legacy-disabled', 'legacy-disabled');
  git(root, 'add', '--', '.github', 'config.cjs', 'requirements');
  git(root, 'commit', '-qm', 'test: preserve legacy adoption state');
  const headSha = git(root, 'rev-parse', 'HEAD');
  const repository = 'phuongnse/renovate-ops';
  const eventPath = await eventFile(root, baseSha, headSha, repository);
  const result = runVerifier(
    root,
    eventPath,
    path.join(root, 'report.json'),
    repository,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('operations verifier accepts the correlated active adoption state', async () => {
  const { root, baseSha } = await fixture();
  await prepareOperationsConsumer(root, 'active', 'active');
  git(root, 'add', '--', '.github', 'config.cjs', 'requirements');
  git(root, 'commit', '-qm', 'test: active operations adoption');
  const headSha = git(root, 'rev-parse', 'HEAD');
  const repository = 'phuongnse/renovate-ops';
  const eventPath = await eventFile(root, baseSha, headSha, repository);
  const result = runVerifier(
    root,
    eventPath,
    path.join(root, 'report.json'),
    repository,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('operations verifier rejects adoption and allowlist state mismatches', async (context) => {
  for (const [adoptionState, allowlistState] of [
    ['legacy-disabled', 'active'],
    ['active', 'legacy-disabled'],
  ]) {
    await context.test(`${adoptionState} with ${allowlistState} allowlist`, async () => {
      const { root, baseSha } = await fixture();
      await prepareOperationsConsumer(root, adoptionState, allowlistState);
      git(root, 'add', '--', '.github', 'config.cjs', 'requirements');
      git(root, 'commit', '-qm', 'test: mismatched operations adoption');
      const headSha = git(root, 'rev-parse', 'HEAD');
      const repository = 'phuongnse/renovate-ops';
      const eventPath = await eventFile(root, baseSha, headSha, repository);
      const result = runVerifier(
        root,
        eventPath,
        path.join(root, 'report.json'),
        repository,
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /process adoption requires/);
    });
  }
});

test('policy verifier rejects unsafe process adoption configuration', async (context) => {
  const cases = [
    {
      name: 'enabled rule without the exact adoption task',
      mutate: (config) => {
        config.packageRules = [{
          automerge: false,
          enabled: true,
          matchFileNames: ['requirements/process.in', 'requirements/process.txt'],
          matchPackageNames: ['engineering-process'],
        }];
      },
      expected: /invalid adoption task/,
    },
    {
      name: 'post-upgrade task',
      mutate: (config) => {
        config.postUpgradeTasks = {
          commands: ['python .process/adopt-process.py'],
          executionMode: 'branch',
        };
      },
      expected: /postUpgradeTasks must be scoped/,
    },
    {
      name: 'missing authority rule for a process consumer',
      mutate: (config) => {
        config.packageRules = [{ automerge: false }];
      },
      prepare: async (root) => {
        await mkdir(path.join(root, 'requirements'), { recursive: true });
        await writeFile(
          path.join(root, 'requirements', 'process.in'),
          'engineering-process==0.4.0\n',
        );
      },
      expected: /exactly one engineering-process rule is required/,
    },
  ];
  for (const item of cases) {
    await context.test(item.name, async () => {
      const { root, baseSha } = await fixture();
      const configPath = path.join(root, '.github', 'renovate.json5');
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      item.mutate(config);
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
      if (item.prepare) await item.prepare(root);
      git(root, 'add', '--', '.github/renovate.json5');
      if (item.prepare) git(root, 'add', '--', 'requirements/process.in');
      git(root, 'commit', '-qm', 'test: mutate process policy');
      const headSha = git(root, 'rev-parse', 'HEAD');
      const eventPath = await eventFile(root, baseSha, headSha);

      const result = runVerifier(root, eventPath, path.join(root, 'report.json'));

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, item.expected);
    });
  }
});
