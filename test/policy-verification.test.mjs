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
    [
      'name: CI',
      'on: [pull_request]',
      'jobs:',
      '  policy-verification:',
      '    name: Policy verification',
      `    uses: phuongnse/renovate-ops/.github/workflows/policy-verification.yml@${checkoutSha}`,
      '  verify:',
      '    name: Verify (${{ matrix.os }}, Python ${{ matrix.python }})',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      `      - uses: actions/checkout@${checkoutSha}`,
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, '.github', 'renovate.json5'),
    `${JSON.stringify(
      {
        branchPrefix: 'automation/renovate/',
        draftPR: true,
        packageRules: [{}],
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
        enabled: true,
        draftPR: true,
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
        enabled: false,
        draftPR: true,
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
    'name: Renovate\non: workflow_dispatch\njobs:\n  renovate:\n    name: Renovate\n    runs-on: ubuntu-24.04\n',
  );
  await writeFile(
    path.join(root, '.github', 'workflows', 'policy-verification.yml'),
    'name: Policy verification\non: workflow_call\njobs:\n  policy-verification:\n    name: Shared policy\n    runs-on: ubuntu-24.04\n',
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

test('policy verifier rejects invalid workflow display names', async (context) => {
  const cases = [
    {
      name: 'missing workflow display name',
      replace: ['name: CI\n', ''],
      expected: /workflow must declare exactly one display name/,
    },
    {
      name: 'lowercase workflow display name',
      replace: ['name: CI', 'name: ci'],
      expected: /display name must be sentence case/,
    },
    {
      name: 'missing job display name',
      replace: ['    name: Verify (${{ matrix.os }}, Python ${{ matrix.python }})\n', ''],
      expected: /job verify must declare exactly one display name/,
    },
    {
      name: 'slash-delimited matrix display name',
      replace: [
        'Verify (${{ matrix.os }}, Python ${{ matrix.python }})',
        'Verify / ${{ matrix.os }} / ${{ matrix.python }}',
      ],
      expected: /matrix display name must use one final parenthesized suffix/,
    },
    {
      name: 'duplicated shared policy caller name',
      replace: ['name: Policy verification', 'name: Shared policy'],
      expected: /shared policy caller must be named Policy verification/,
    },
    {
      name: 'block scalar display name',
      replace: ['name: CI', 'name: >'],
      expected: /display name must be a plain one-line string/,
    },
  ];
  for (const item of cases) {
    await context.test(item.name, async () => {
      const { root, baseSha } = await fixture();
      const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
      const workflow = await readFile(workflowPath, 'utf8');
      assert.ok(workflow.includes(item.replace[0]));
      await writeFile(workflowPath, workflow.replace(...item.replace));
      git(root, 'add', '--', '.github/workflows/ci.yml');
      git(root, 'commit', '-qm', 'test: use invalid workflow display name');
      const headSha = git(root, 'rev-parse', 'HEAD');
      const eventPath = await eventFile(root, baseSha, headSha);
      const result = runVerifier(root, eventPath, path.join(root, 'report.json'));

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, item.expected);
    });
  }
});

test('policy verifier accepts quoted sentence-case names with comments', async () => {
  const { root, baseSha } = await fixture();
  const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
  const workflow = await readFile(workflowPath, 'utf8');
  await writeFile(
    workflowPath,
    workflow
      .replace('name: CI', 'name: "CI" # public workflow')
      .replace('name: Policy verification', "name: 'Policy verification' # caller"),
  );
  git(root, 'add', '--', '.github/workflows/ci.yml');
  git(root, 'commit', '-qm', 'test: quote workflow display names');
  const headSha = git(root, 'rev-parse', 'HEAD');
  const eventPath = await eventFile(root, baseSha, headSha);
  const result = runVerifier(root, eventPath, path.join(root, 'report.json'));

  assert.equal(result.status, 0, result.stderr);
});

test('policy verifier rejects a mutable action reference', async () => {
  const { root, baseSha } = await fixture();
  await writeFile(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    'name: CI\non: [pull_request]\njobs:\n  verify:\n    name: Verify\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@main\n',
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
    enabled: false,
    draftPR: true,
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
          enabled: true,
          draftPR: true,
          matchFileNames: ['requirements/process.in', 'requirements/process.txt'],
          matchPackageNames: ['engineering-process'],
        }];
      },
      expected: /invalid adoption task/,
    },
    {
      name: 'ready global pull requests',
      mutate: (config) => {
        config.draftPR = false;
      },
      expected: /draftPR must be true/,
    },
    {
      name: 'ready process-adoption pull requests',
      mutate: (config) => {
        config.packageRules = [{
          draftPR: false,
          enabled: true,
          matchFileNames: ['requirements/process.in', 'requirements/process.txt'],
          matchPackageNames: ['engineering-process'],
          postUpgradeTasks: {
            commands: [ADOPTION_COMMAND],
            executionMode: 'update',
            fileFilters: ADOPTION_FILE_FILTERS,
            installTools: { python: {} },
          },
        }];
      },
      prepare: async (root) => {
        await mkdir(path.join(root, 'requirements'), { recursive: true });
        await writeFile(
          path.join(root, 'requirements', 'process.in'),
          'engineering-process==0.4.0\n',
        );
      },
      expected: /must keep the adoption pull request in draft/,
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
        config.packageRules = [{}];
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
