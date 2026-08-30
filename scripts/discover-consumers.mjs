import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  CONFIG_PATHS,
  manifestForConsumer,
  MAX_CONSUMERS,
  MAX_MANIFEST_BYTES,
  validateConsumerManifest,
} from './validate-consumer-manifest.mjs';
import { classifyProcessAdoptionRule } from './process-adoption-contract.mjs';

const API_ROOT = 'https://api.github.com';
const MAX_API_BYTES = 1_000_000;
const MAX_AGGREGATE_API_BYTES = 16_000_000;
const MAX_CONFIG_BYTES = 256_000;
const API_TIMEOUT_MS = 30_000;

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function validateToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 2_000) {
    throw new Error('GitHub App token is invalid');
  }
}

async function boundedResponse(response, label, budget, { allowNotFound = false } = {}) {
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined && Number(declared) > MAX_API_BYTES) {
    throw new Error(`${label} exceeds the response size limit`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_API_BYTES) throw new Error(`${label} exceeds the response size limit`);
  budget.bytes += bytes.length;
  if (budget.bytes > budget.limit) throw new Error('GitHub API responses exceed the aggregate size limit');
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${document.message ?? 'unknown error'}`);
  }
  return document;
}

function client(token, fetchImpl, {
  maxAggregateBytes = MAX_AGGREGATE_API_BYTES,
  timeoutMs = API_TIMEOUT_MS,
} = {}) {
  validateToken(token);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > API_TIMEOUT_MS) {
    throw new Error(`GitHub API timeout must be between 1 and ${API_TIMEOUT_MS} milliseconds`);
  }
  if (!Number.isInteger(maxAggregateBytes) || maxAggregateBytes < 1 || maxAggregateBytes > MAX_AGGREGATE_API_BYTES) {
    throw new Error(`GitHub API aggregate limit must be between 1 and ${MAX_AGGREGATE_API_BYTES} bytes`);
  }
  const budget = { bytes: 0, limit: maxAggregateBytes };
  return async (path, options = {}) => {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'phuongnse-renovate-ops',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return boundedResponse(response, `GET ${path}`, budget, options);
  };
}

function decodeConfig(document, label) {
  if (
    document === null
    || document.type !== 'file'
    || document.encoding !== 'base64'
    || typeof document.content !== 'string'
    || !Number.isInteger(document.size)
  ) {
    throw new Error(`${label} is not a base64 file`);
  }
  const encoded = document.content.replaceAll('\n', '');
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error(`${label} contains invalid base64`);
  }
  const content = Buffer.from(encoded, 'base64');
  if (content.toString('base64') !== encoded || document.size !== content.length) {
    throw new Error(`${label} base64 size or content is inconsistent`);
  }
  if (content.length < 2 || content.length > MAX_CONFIG_BYTES) {
    throw new Error(`${label} exceeds the config size contract`);
  }
  let config;
  try {
    config = JSON.parse(content.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} must use strict JSON: ${error.message}`);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${label} must contain an object`);
  }
  return { config, content };
}

export function classifyConsumerIntent(config, label = 'consumer config') {
  if (!Object.hasOwn(config, 'enabled')) return 'absent';
  if (typeof config.enabled !== 'boolean') throw new Error(`${label}.enabled must be boolean`);
  if (!config.enabled) return 'disabled';
  if (config.automerge !== false) throw new Error(`${label}.automerge must be false`);
  if (Object.hasOwn(config, 'draftPR') && typeof config.draftPR !== 'boolean') {
    throw new Error(`${label}.draftPR must be boolean when present`);
  }
  if (config.branchPrefix !== 'automation/renovate/') {
    throw new Error(`${label}.branchPrefix is invalid`);
  }
  if (Object.hasOwn(config, 'packageRules') && !Array.isArray(config.packageRules)) {
    throw new Error(`${label}.packageRules must be an array`);
  }
  if (config.packageRules?.some((rule) => rule?.automerge === true)) {
    throw new Error(`${label} enables package-rule automerge`);
  }
  if (Object.hasOwn(config, 'postUpgradeTasks')) {
    throw new Error(`${label}.postUpgradeTasks must be scoped to the engineering-process rule`);
  }
  const processRules = (config.packageRules ?? []).filter((rule) =>
    rule?.matchPackageNames?.includes('engineering-process')
  );
  if (processRules.length !== 1) {
    throw new Error(`${label} must contain exactly one engineering-process rule`);
  }
  return classifyProcessAdoptionRule(
    processRules[0], `${label}.engineering-process rule`
  ) === 'active' ? 'enabled' : 'disabled';
}

export function validateConsumerIntent(config, label = 'consumer config') {
  return classifyConsumerIntent(config, label) === 'enabled';
}

async function repositoryCheckpoint(api, repository, defaultBranch) {
  const commit = await api(
    `/repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`,
  );
  if (typeof commit?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new Error(`${repository} default-branch checkpoint is invalid`);
  }
  return commit.sha;
}

async function configAtCheckpoint(api, repository, checkpoint) {
  const found = [];
  for (const configPath of CONFIG_PATHS) {
    const document = await api(
      `/repos/${repository}/contents/${configPath}?ref=${checkpoint}`,
      { allowNotFound: true },
    );
    if (document !== null) found.push({ configPath, ...decodeConfig(document, `${repository}/${configPath}`) });
  }
  if (found.length > 1) throw new Error(`${repository} has ambiguous Renovate config paths`);
  return found[0] ?? null;
}

export async function discoverConsumers({
  fetchImpl = fetch,
  maxAggregateBytes,
  timeoutMs,
  token,
}) {
  const api = client(token, fetchImpl, { maxAggregateBytes, timeoutMs });
  const installation = await api('/installation/repositories?per_page=100&page=1');
  if (
    !Number.isInteger(installation?.total_count)
    || !Array.isArray(installation.repositories)
    || installation.total_count !== installation.repositories.length
    || installation.total_count < 1
    || installation.total_count > MAX_CONSUMERS
  ) {
    throw new Error(`GitHub App installation must expose between 1 and ${MAX_CONSUMERS} repositories in one bounded page`);
  }
  const consumers = [];
  const exclusions = [];
  const repositories = [...installation.repositories].sort((left, right) => {
    const leftName = String(left.full_name);
    const rightName = String(right.full_name);
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
  for (const repository of repositories) {
    if (
      repository === null
      || typeof repository.full_name !== 'string'
      || !/^phuongnse\/[a-z0-9._-]+$/.test(repository.full_name)
      || typeof repository.default_branch !== 'string'
      || repository.default_branch.length < 1
      || repository.default_branch.length > 255
    ) {
      throw new Error('GitHub App installation returned an invalid repository identity');
    }
    const checkpoint = await repositoryCheckpoint(
      api,
      repository.full_name,
      repository.default_branch,
    );
    const selected = await configAtCheckpoint(api, repository.full_name, checkpoint);
    if (selected === null) {
      exclusions.push({
        repository: repository.full_name,
        checkpoint,
        reason: 'intent-absent',
      });
      continue;
    }
    const intent = classifyConsumerIntent(
      selected.config,
      `${repository.full_name}/${selected.configPath}`,
    );
    if (intent !== 'enabled') {
      exclusions.push({
        repository: repository.full_name,
        checkpoint,
        reason: `intent-${intent}`,
      });
      continue;
    }
    if (repository.archived === true || repository.disabled === true) {
      throw new Error(`${repository.full_name} explicitly enables Renovate but is unavailable`);
    }
    consumers.push({
      repository: repository.full_name,
      defaultBranch: repository.default_branch,
      checkpoint,
      configPath: selected.configPath,
      configSha256: digest(selected.content),
    });
  }
  return validateConsumerManifest({ schemaVersion: 1, consumers, exclusions });
}

export async function revalidateConsumer(consumer, {
  fetchImpl = fetch,
  maxAggregateBytes,
  timeoutMs,
  token,
}) {
  const manifest = manifestForConsumer(consumer);
  const expected = manifest.consumers[0];
  const api = client(token, fetchImpl, { maxAggregateBytes, timeoutMs });
  const checkpoint = await repositoryCheckpoint(
    api,
    expected.repository,
    expected.defaultBranch,
  );
  if (checkpoint !== expected.checkpoint) {
    throw new Error(`${expected.repository} default branch changed after discovery`);
  }
  const selected = await configAtCheckpoint(api, expected.repository, expected.checkpoint);
  if (selected === null || selected.configPath !== expected.configPath) {
    throw new Error(`${expected.repository} Renovate config path changed after discovery`);
  }
  if (digest(selected.content) !== expected.configSha256) {
    throw new Error(`${expected.repository} Renovate config changed after discovery`);
  }
  if (!validateConsumerIntent(selected.config, `${expected.repository}/${selected.configPath}`)) {
    throw new Error(`${expected.repository} disabled Renovate after discovery`);
  }
  return { repository: expected.repository, status: 'passed' };
}

async function emitOutputs(manifest) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  const matrix = JSON.stringify({ include: manifest.consumers });
  if (Buffer.byteLength(matrix) > MAX_MANIFEST_BYTES) {
    throw new Error('consumer matrix exceeds the output size contract');
  }
  await appendFile(
    output,
    `matrix=${matrix}\ncount=${manifest.consumers.length}\nexcluded=${manifest.exclusions.length}\n`,
    'utf8',
  );
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--revalidate') {
    const encoded = process.env.RENOVATE_CONSUMER_JSON;
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_MANIFEST_BYTES) {
      throw new Error('RENOVATE_CONSUMER_JSON must be a bounded string');
    }
    const consumer = JSON.parse(encoded);
    const result = await revalidateConsumer(consumer, { token: process.env.GH_TOKEN });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (process.argv.length !== 3) {
    throw new Error('usage: discover-consumers.mjs OUTPUT | --revalidate');
  }
  const manifest = await discoverConsumers({ token: process.env.GH_TOKEN });
  await writeFile(process.argv[2], `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await emitOutputs(manifest);
  process.stdout.write(`${JSON.stringify({ consumers: manifest.consumers.length, exclusions: manifest.exclusions, status: 'passed' })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`consumer discovery failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
