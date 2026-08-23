import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const verifier = fileURLToPath(new URL('../scripts/independent-review.mjs', import.meta.url));
const checkoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'renovate-independent-review-'));
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(
    path.join(root, '.github', 'workflows', 'ci.yml'),
    `name: CI\non: [pull_request]\njobs:\n  verify:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${checkoutSha}\n`,
  );
  await writeFile(
    path.join(root, '.github', 'renovate.json5'),
    `${JSON.stringify(
      {
        enabled: true,
        automerge: false,
        branchPrefix: 'automation/renovate/',
        draftPR: true,
        packageRules: [{ automerge: false }],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(root, 'README.md'), 'base\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'review-test@example.invalid');
  git(root, 'config', 'user.name', 'Independent Review Test');
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

async function eventFile(root, baseSha, headSha) {
  const eventPath = path.join(root, 'event.json');
  await writeFile(
    eventPath,
    `${JSON.stringify({
      repository: { full_name: 'phuongnse/new-process-consumer' },
      pull_request: {
        number: 7,
        base: { ref: 'main', sha: baseSha },
        head: { ref: 'feature', sha: headSha },
      },
    })}\n`,
  );
  return eventPath;
}

function runVerifier(root, eventPath, outputPath) {
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
        GITHUB_REPOSITORY: 'phuongnse/new-process-consumer',
        TRUSTED_WORKFLOW_REPOSITORY: 'phuongnse/renovate-ops',
        TRUSTED_WORKFLOW_SHA: 'a'.repeat(40),
      },
    },
  );
}

test('independent verifier uses the explicit immutable event path', async () => {
  const { root, baseSha, headSha } = await fixture();
  const eventPath = await eventFile(root, baseSha, headSha);
  const outputPath = path.join(root, 'evidence', 'report.json');

  const result = runVerifier(root, eventPath, outputPath);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(report.status, 'passed');
  assert.equal(report.governanceMode, 'single-maintainer');
  assert.equal(report.verificationKind, 'independent-automated');
  assert.equal(report.repository, 'phuongnse/new-process-consumer');
  assert.equal(report.baseSha, baseSha);
  assert.equal(report.headSha, headSha);
  assert.deepEqual(report.changedFileCount, 1);
});

test('independent verifier rejects a mutable action reference', async () => {
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

test('independent verifier rejects an event for a different caller repository', async () => {
  const { root, baseSha, headSha } = await fixture();
  const eventPath = await eventFile(root, baseSha, headSha);
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  event.repository.full_name = 'phuongnse/different-consumer';
  await writeFile(eventPath, `${JSON.stringify(event)}\n`);

  const result = runVerifier(root, eventPath, path.join(root, 'report.json'));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /event repository does not match the caller/);
});
