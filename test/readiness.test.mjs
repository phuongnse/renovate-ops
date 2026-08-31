import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const project = JSON.parse(await readFile(new URL('.process/project.json', root)));
const readiness = JSON.parse(await readFile(new URL('.process/readiness.json', root)));

const expected = {
  auditability: ['development'],
  'automation-correctness': ['development'],
  'bounded-execution': ['development'],
  'least-privilege': ['development', 'review'],
  'policy-integrity': ['development', 'review'],
  recovery: ['development'],
  'target-selection-integrity': ['development'],
};

const expectedCapabilities = Object.fromEntries(
  Object.entries(expected).map(([id, evidenceProfiles]) => [
    id,
    { state: 'enforced', evidenceProfiles },
  ]),
);

test('operations readiness sidecar is exact, versioned, and authority-resolvable', () => {
  assert.equal(Object.hasOwn(project, 'readiness'), false);
  assert.deepEqual(Object.keys(readiness).sort(), ['capabilities', 'packs', 'stage', 'target']);
  assert.equal(readiness.target, 'production');
  assert.equal(readiness.stage, 'production');
  assert.deepEqual(readiness.packs, [{ id: 'operations', version: 1 }]);
  assert.equal(new Set(readiness.capabilities.map(({ id }) => id)).size, readiness.capabilities.length);
  assert.deepEqual(
    Object.fromEntries(readiness.capabilities.map(({ id, ...capability }) => [id, capability])),
    expectedCapabilities,
  );
});

test('every operations capability resolves only to required profile checks', () => {
  assert.deepEqual(project.lifecycle.requiredProfiles, ['development', 'review']);
  const required = new Set(project.lifecycle.requiredProfiles);
  const checks = Object.fromEntries(
    Object.entries(project.profiles).map(([profile, entries]) => [
      profile,
      entries.map(({ id }) => id),
    ]),
  );
  assert.deepEqual(checks, {
    development: ['unit'],
    review: ['global-renovate-config', 'repository-renovate-config'],
  });
  for (const profiles of Object.values(expected)) {
    assert.ok(profiles.every((profile) => required.has(profile) && checks[profile].length > 0));
  }
});
