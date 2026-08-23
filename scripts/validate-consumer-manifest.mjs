import { lstat, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const MAX_CONSUMERS = 64;
export const MAX_MANIFEST_BYTES = 256_000;
export const CONFIG_PATHS = [
  '.github/renovate.json',
  '.github/renovate.json5',
];

const REPOSITORY_PATTERN = /^phuongnse\/[a-z0-9._-]+$/;
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9_-])?$/;
const CHECKPOINT_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unexpected fields`);
  }
}

export function validateConsumer(value, label = 'consumer') {
  exactKeys(
    value,
    ['configPath', 'configSha256', 'defaultBranch', 'checkpoint', 'repository'],
    label,
  );
  if (!REPOSITORY_PATTERN.test(value.repository)) {
    throw new Error(`${label}.repository is invalid`);
  }
  if (
    typeof value.defaultBranch !== 'string'
    || value.defaultBranch.length > 255
    || !BRANCH_PATTERN.test(value.defaultBranch)
  ) {
    throw new Error(`${label}.defaultBranch is invalid`);
  }
  if (!CHECKPOINT_PATTERN.test(value.checkpoint)) {
    throw new Error(`${label}.checkpoint is invalid`);
  }
  if (!CONFIG_PATHS.includes(value.configPath)) {
    throw new Error(`${label}.configPath is invalid`);
  }
  if (!DIGEST_PATTERN.test(value.configSha256)) {
    throw new Error(`${label}.configSha256 is invalid`);
  }
  return {
    repository: value.repository,
    defaultBranch: value.defaultBranch,
    checkpoint: value.checkpoint,
    configPath: value.configPath,
    configSha256: value.configSha256,
  };
}

export function validateConsumerManifest(value, label = 'consumer manifest') {
  exactKeys(value, ['schemaVersion', 'consumers'], label);
  if (value.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if (
    !Array.isArray(value.consumers)
    || value.consumers.length < 1
    || value.consumers.length > MAX_CONSUMERS
  ) {
    throw new Error(`${label}.consumers must contain between 1 and ${MAX_CONSUMERS} entries`);
  }
  const consumers = value.consumers.map((consumer, index) => (
    validateConsumer(consumer, `${label}.consumers[${index}]`)
  ));
  const repositories = consumers.map((consumer) => consumer.repository);
  if (new Set(repositories).size !== repositories.length) {
    throw new Error(`${label}.consumers contains duplicate repositories`);
  }
  const sorted = [...repositories].sort();
  if (JSON.stringify(repositories) !== JSON.stringify(sorted)) {
    throw new Error(`${label}.consumers must be sorted by repository`);
  }
  return { schemaVersion: 1, consumers };
}

export async function readConsumerManifest(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_MANIFEST_BYTES) {
    throw new Error('consumer manifest must be a bounded regular file');
  }
  const content = await readFile(path);
  const after = await lstat(path);
  if (
    content.length !== before.size
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
    || after.mode !== before.mode
  ) {
    throw new Error('consumer manifest changed while reading');
  }
  let document;
  try {
    document = JSON.parse(content.toString('utf8'));
  } catch (error) {
    throw new Error(`consumer manifest is invalid JSON: ${error.message}`);
  }
  return validateConsumerManifest(document);
}

export function manifestForConsumer(value) {
  return validateConsumerManifest({ schemaVersion: 1, consumers: [value] });
}

async function main() {
  if (process.argv.length === 4 && process.argv[2] === '--from-env') {
    const encoded = process.env.RENOVATE_CONSUMER_JSON;
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_MANIFEST_BYTES) {
      throw new Error('RENOVATE_CONSUMER_JSON must be a bounded string');
    }
    let consumer;
    try {
      consumer = JSON.parse(encoded);
    } catch (error) {
      throw new Error(`RENOVATE_CONSUMER_JSON is invalid JSON: ${error.message}`);
    }
    const manifest = manifestForConsumer(consumer);
    await writeFile(process.argv[3], `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
    return;
  }
  if (process.argv.length !== 3) {
    throw new Error('usage: validate-consumer-manifest.mjs MANIFEST | --from-env OUTPUT');
  }
  const manifest = await readConsumerManifest(process.argv[2]);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`consumer manifest validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
