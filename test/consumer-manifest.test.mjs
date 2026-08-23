import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  manifestForConsumer,
  readConsumerManifest,
  validateConsumerManifest,
} from '../scripts/validate-consumer-manifest.mjs';

const first = {
  repository: 'phuongnse/axis',
  defaultBranch: 'main',
  checkpoint: 'a'.repeat(40),
  configPath: '.github/renovate.json5',
  configSha256: `sha256:${'b'.repeat(64)}`,
};

const second = {
  repository: 'phuongnse/lyric-rail',
  defaultBranch: 'main',
  checkpoint: 'c'.repeat(40),
  configPath: '.github/renovate.json',
  configSha256: `sha256:${'d'.repeat(64)}`,
};

test('consumer manifest accepts one exact sorted bounded contract', () => {
  assert.deepEqual(manifestForConsumer(first), {
    schemaVersion: 1,
    consumers: [first],
    exclusions: [],
  });
  assert.deepEqual(validateConsumerManifest({ schemaVersion: 1, consumers: [first, second], exclusions: [] }), {
    schemaVersion: 1,
    consumers: [first, second],
    exclusions: [],
  });
  assert.deepEqual(
    validateConsumerManifest({
      schemaVersion: 1,
      consumers: [],
      exclusions: [{ repository: first.repository, checkpoint: first.checkpoint, reason: 'intent-disabled' }],
    }).consumers,
    [],
  );
});

test('consumer manifest rejects duplicates, ordering drift, and extra fields', () => {
  assert.throws(
    () => validateConsumerManifest({ schemaVersion: 1, consumers: [first, first], exclusions: [] }),
    /duplicate repositories/,
  );
  assert.throws(
    () => validateConsumerManifest({ schemaVersion: 1, consumers: [second, first], exclusions: [] }),
    /sorted by repository/,
  );
  assert.throws(
    () => validateConsumerManifest({ schemaVersion: 1, consumers: [{ ...first, token: 'secret' }], exclusions: [] }),
    /unexpected fields/,
  );
  assert.throws(
    () => validateConsumerManifest({ schemaVersion: 1, consumers: [], exclusions: [] }),
    /classify at least one repository/,
  );
});

test('consumer manifest reader rejects oversized and invalid files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'renovate-consumer-manifest-'));
  const invalid = path.join(root, 'invalid.json');
  await writeFile(invalid, '{not-json}\n');
  await assert.rejects(() => readConsumerManifest(invalid), /invalid JSON/);

  const oversized = path.join(root, 'oversized.json');
  await writeFile(oversized, 'x'.repeat(256_001));
  await assert.rejects(() => readConsumerManifest(oversized), /bounded regular file/);
});
