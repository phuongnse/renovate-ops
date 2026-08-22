import assert from 'node:assert/strict';
import test from 'node:test';

import { validateRenovateRecords } from '../scripts/validate-renovate-log.mjs';

const repositories = ['phuongnse/engineering-process', 'phuongnse/axis'];

function completions(result = 'done') {
  return repositories.map((repository) => ({
    msg: 'Repository finished',
    repository,
    result,
  }));
}

test('Renovate outcomes require every allowlisted repository to finish cleanly', () => {
  assert.deepEqual(validateRenovateRecords(completions(), repositories), {
    repositories: [...repositories].sort(),
    status: 'passed',
  });
});

test('Renovate outcomes reject lockfile errors', () => {
  const records = completions();
  records[0].result = 'lockfile-error';
  assert.throws(() => validateRenovateRecords(records, repositories), /lockfile-error/);
});

test('Renovate outcomes reject branch artifact errors', () => {
  const records = [
    ...completions(),
    {
      artifactErrors: [{ stderr: 'adoption failed' }],
      repository: repositories[1],
    },
  ];
  assert.throws(() => validateRenovateRecords(records, repositories), /artifact errors/);
});

test('Renovate outcomes reject missing or unexpected repositories', () => {
  assert.throws(
    () => validateRenovateRecords(completions().slice(1), repositories),
    /did not complete/,
  );
  assert.throws(
    () => validateRenovateRecords([
      ...completions(),
      { msg: 'Repository finished', repository: 'phuongnse/unexpected', result: 'done' },
    ], repositories),
    /unexpected repository/,
  );
});
