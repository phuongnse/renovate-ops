import assert from 'node:assert/strict';
import test from 'node:test';

import {
  discoverConsumers,
  revalidateConsumer,
  validateConsumerIntent,
} from '../scripts/discover-consumers.mjs';

const token = 'installation-token-value';
const adoptionCommand =
  'python .process/adopt-process.py --project-root . --requirements-lock requirements/process.txt';

function intent(enabled = true) {
  return {
    enabled,
    automerge: false,
    draftPR: true,
    branchPrefix: 'automation/renovate/',
    packageRules: [{ automerge: false }],
    postUpgradeTasks: {
      commands: [adoptionCommand],
      executionMode: 'branch',
    },
  };
}

function response(document, status = 200) {
  const bytes = Buffer.from(JSON.stringify(document));
  return {
    arrayBuffer: async () => bytes,
    headers: { get: (name) => (name === 'content-length' ? String(bytes.length) : null) },
    ok: status >= 200 && status < 300,
    status,
  };
}

function encodedConfig(config) {
  const content = Buffer.from(`${JSON.stringify(config)}\n`);
  return {
    content: content.toString('base64'),
    encoding: 'base64',
    size: content.length,
    type: 'file',
  };
}

function fixtureFetch({
  axisConfig = intent(true),
  axisJsonAlso = false,
  axisSha = 'a'.repeat(40),
  lyricConfig = intent(false),
  lyricSha = 'b'.repeat(40),
  totalCount = 2,
} = {}) {
  return async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path === '/installation/repositories?per_page=100&page=1') {
      const repositories = [
        { archived: false, default_branch: 'main', disabled: false, full_name: 'phuongnse/lyric-rail' },
        { archived: false, default_branch: 'main', disabled: false, full_name: 'phuongnse/axis' },
      ];
      return response({ repositories, total_count: totalCount });
    }
    if (path === '/repos/phuongnse/axis/commits/main') return response({ sha: axisSha });
    if (path === '/repos/phuongnse/lyric-rail/commits/main') return response({ sha: lyricSha });
    if (path === `/repos/phuongnse/axis/contents/.github/renovate.json?ref=${axisSha}`) {
      return axisJsonAlso ? response(encodedConfig(axisConfig)) : response({ message: 'Not Found' }, 404);
    }
    if (path === `/repos/phuongnse/axis/contents/.github/renovate.json5?ref=${axisSha}`) {
      return response(encodedConfig(axisConfig));
    }
    if (path === `/repos/phuongnse/lyric-rail/contents/.github/renovate.json?ref=${lyricSha}`) {
      return response(encodedConfig(lyricConfig));
    }
    if (path === `/repos/phuongnse/lyric-rail/contents/.github/renovate.json5?ref=${lyricSha}`) {
      return response({ message: 'Not Found' }, 404);
    }
    throw new Error(`unexpected request ${path}`);
  };
}

test('consumer intent requires explicit enablement and closed adoption policy', () => {
  assert.equal(validateConsumerIntent(intent(true)), true);
  assert.equal(validateConsumerIntent(intent(false)), false);
  const absent = intent(true);
  delete absent.enabled;
  assert.equal(validateConsumerIntent(absent), false);
  assert.throws(
    () => validateConsumerIntent({ ...intent(true), automerge: true }),
    /automerge must be false/,
  );
  assert.throws(
    () => validateConsumerIntent({ ...intent(true), postUpgradeTasks: { commands: ['bad'] } }),
    /adoption contract/,
  );
});

test('discovery selects only explicit consumer-owned intent and sorts the result', async () => {
  const manifest = await discoverConsumers({ fetchImpl: fixtureFetch(), token });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.consumers.length, 1);
  assert.equal(manifest.consumers[0].repository, 'phuongnse/axis');
  assert.equal(manifest.consumers[0].checkpoint, 'a'.repeat(40));
  assert.equal(manifest.consumers[0].configPath, '.github/renovate.json5');
  assert.match(manifest.consumers[0].configSha256, /^sha256:[0-9a-f]{64}$/);
});

test('discovery rejects ambiguous config and installation bounds', async () => {
  await assert.rejects(
    () => discoverConsumers({ fetchImpl: fixtureFetch({ axisJsonAlso: true }), token }),
    /ambiguous Renovate config paths/,
  );
  await assert.rejects(
    () => discoverConsumers({ fetchImpl: fixtureFetch({ totalCount: 65 }), token }),
    /between 1 and 64 repositories/,
  );
});

test('discovery bounds aggregate API bytes and timeout', async () => {
  await assert.rejects(
    () => discoverConsumers({
      fetchImpl: fixtureFetch(),
      maxAggregateBytes: 10,
      token,
    }),
    /aggregate size limit/,
  );
  const neverCompletes = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  await assert.rejects(
    () => discoverConsumers({ fetchImpl: neverCompletes, timeoutMs: 5, token }),
    (error) => error?.name === 'TimeoutError',
  );
});

test('revalidation rejects a default-branch race before execution', async () => {
  const manifest = await discoverConsumers({ fetchImpl: fixtureFetch(), token });
  const consumer = manifest.consumers[0];
  const changed = fixtureFetch({ axisSha: 'c'.repeat(40) });

  await assert.rejects(
    () => revalidateConsumer(consumer, { fetchImpl: changed, token }),
    /default branch changed after discovery/,
  );
});
