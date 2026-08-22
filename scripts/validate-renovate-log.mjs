import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAX_LOG_BYTES = 20_000_000;
const MAX_LOG_LINES = 100_000;

export function validateRenovateRecords(records, repositories) {
  const expected = new Set(repositories);
  const completed = new Map();
  for (const record of records) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Renovate log contains a non-object record');
    }
    if (Array.isArray(record.artifactErrors) && record.artifactErrors.length > 0) {
      throw new Error(`Renovate reported artifact errors for ${record.repository ?? 'unknown'}`);
    }
    if (record.msg !== 'Repository finished') continue;
    const repository = record.repository;
    if (!expected.has(repository)) {
      throw new Error(`Renovate completed an unexpected repository: ${repository}`);
    }
    if (completed.has(repository)) {
      throw new Error(`Renovate emitted duplicate completion for ${repository}`);
    }
    if (record.result !== 'done') {
      throw new Error(`Renovate ${repository} finished with result ${record.result}`);
    }
    completed.set(repository, record.result);
  }
  const missing = repositories.filter((repository) => !completed.has(repository));
  if (missing.length > 0) {
    throw new Error(`Renovate did not complete: ${missing.join(', ')}`);
  }
  return {
    repositories: [...completed.keys()].sort(),
    status: 'passed',
  };
}

async function boundedRecords(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_LOG_BYTES) {
    throw new Error('Renovate log must be a bounded regular file');
  }
  const content = await readFile(path, 'utf8');
  const after = await lstat(path);
  if (
    Buffer.byteLength(content) !== before.size
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
    || after.mode !== before.mode
  ) {
    throw new Error('Renovate log changed while reading');
  }
  const lines = content.split('\n').filter(Boolean);
  if (lines.length > MAX_LOG_LINES) {
    throw new Error('Renovate log exceeds the line limit');
  }
  return lines.map((line, index) => {
    if (Buffer.byteLength(line) > 1_000_000) {
      throw new Error(`Renovate log line ${index + 1} exceeds the size limit`);
    }
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Renovate log line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

async function main() {
  if (process.argv.length !== 4) {
    throw new Error('usage: validate-renovate-log.mjs LOG_PATH REPOSITORIES_PATH');
  }
  const records = await boundedRecords(process.argv[2]);
  const repositories = JSON.parse(await readFile(process.argv[3], 'utf8'));
  if (
    !Array.isArray(repositories)
    || repositories.length === 0
    || repositories.some((repository) => typeof repository !== 'string')
  ) {
    throw new Error('repository allowlist must be a non-empty string array');
  }
  process.stdout.write(`${JSON.stringify(validateRenovateRecords(records, repositories))}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Renovate outcome validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
