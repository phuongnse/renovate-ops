import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRenovateRecords } from '../scripts/classify-renovate-log.mjs';
import { waitForRenovateRetry } from '../scripts/wait-for-renovate-retry.mjs';
import {
  RenovateOutcomeError,
  validateRenovateRecords,
} from '../scripts/validate-renovate-log.mjs';

const repositories = ['phuongnse/engineering-process', 'phuongnse/axis'];

function completions(result = 'done') {
  return repositories.map((repository) => ({
    msg: 'Repository finished',
    repository,
    result,
  }));
}

test('Renovate outcomes require every manifest consumer to finish cleanly', () => {
  assert.deepEqual(validateRenovateRecords(completions(), repositories), {
    repositories: [...repositories].sort(),
    status: 'passed',
  });
});

test('Renovate outcomes reject lockfile errors', () => {
  const records = completions();
  records[0].result = 'lockfile-error';
  assert.throws(() => validateRenovateRecords(records, repositories), /lockfile-error/);
  assert.deepEqual(classifyRenovateRecords(records, repositories), {
    classification: 'lockfile-error',
    diagnostic: JSON.stringify({
      repository: repositories[0],
      result: 'lockfile-error',
    }),
    message: `Renovate ${repositories[0]} finished with result lockfile-error`,
    status: 'retryable',
  });
});

test('Renovate outcomes reject branch artifact errors', () => {
  const records = [
    ...completions(),
    {
      artifactErrors: [{ stderr: 'adoption failed' }],
      repository: repositories[1],
    },
  ];
  assert.throws(
    () => classifyRenovateRecords(records, repositories),
    (error) => error instanceof RenovateOutcomeError && error.retryable === false,
  );
});

test('first-attempt classification retries bounded lockfile artifact errors', () => {
  const records = [
    ...completions(),
    {
      artifactErrors: [{ stderr: 'No matching distribution found for engineering-process==0.4.0' }],
      repository: repositories[0],
    },
  ];

  assert.equal(classifyRenovateRecords(records, repositories).status, 'retryable');
});

test('retryable diagnostics redact credential-like assignments', () => {
  const records = [
    ...completions(),
    {
      artifactErrors: [{ stderr: 'lockfile error token=visible-secret' }],
      repository: repositories[0],
    },
  ];

  const result = classifyRenovateRecords(records, repositories);
  assert.match(result.diagnostic, /token=\[redacted\]/);
  assert.doesNotMatch(result.diagnostic, /visible-secret/);
});

test('Renovate outcomes reject missing or unexpected repositories', () => {
  assert.throws(
    () => validateRenovateRecords(completions().slice(1), repositories),
    /did not complete/,
  );
  assert.equal(
    classifyRenovateRecords(completions().slice(1), repositories).classification,
    'missing-completion',
  );
  assert.throws(
    () => validateRenovateRecords([
      ...completions(),
      { msg: 'Repository finished', repository: 'phuongnse/unexpected', result: 'done' },
    ], repositories),
    /unexpected repository/,
  );
});

test('retry wait is fixed, bounded, and injectable without sleeping', async () => {
  const calls = [];
  const result = await waitForRenovateRetry({
    sleepFunction: async (delayMs) => calls.push(delayMs),
  });

  assert.deepEqual(calls, [30_000]);
  assert.deepEqual(result, { delayMs: 30_000, status: 'completed' });
  await assert.rejects(() => waitForRenovateRetry({ delayMs: 30_001 }), /between 1 and 30000/);
});
