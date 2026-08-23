import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { readConsumerManifest } from './validate-consumer-manifest.mjs';

const MAX_LOG_BYTES = 20_000_000;
const MAX_LOG_LINES = 100_000;
const MAX_DIAGNOSTIC_BYTES = 4_096;

export class RenovateOutcomeError extends Error {
  constructor(code, message, { diagnostic = '', retryable = false } = {}) {
    super(message);
    this.name = 'RenovateOutcomeError';
    this.code = code;
    this.diagnostic = diagnostic;
    this.retryable = retryable;
  }
}

function redactDiagnostic(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  const redacted = source
    .replace(
      /((?:authorization|password|private[_-]?key|secret|token)\s*[=:]\s*)[^\s,;]+/giu,
      '$1[redacted]',
    )
    .replace(/https?:\/\/[^@\s/]+@/giu, 'https://[redacted]@');
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.length <= MAX_DIAGNOSTIC_BYTES) return redacted;
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `${bytes.subarray(0, MAX_DIAGNOSTIC_BYTES).toString('utf8')}\n[diagnostic truncated; sha256:${digest}]`;
}

function artifactErrorsAreRetryable(errors) {
  return errors.every((error) => {
    const text = typeof error === 'string' ? error : JSON.stringify(error);
    return /lock.?file|could not find a version.*engineering-process|no matching distribution.*engineering-process/iu.test(text);
  });
}

export function validateRenovateRecords(records, repositories) {
  const expected = new Set(repositories);
  const completed = new Map();
  for (const record of records) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new RenovateOutcomeError('invalid-record', 'Renovate log contains a non-object record');
    }
    if (Array.isArray(record.artifactErrors) && record.artifactErrors.length > 0) {
      const repository = record.repository ?? 'unknown';
      throw new RenovateOutcomeError(
        'artifact-errors',
        `Renovate reported artifact errors for ${repository}`,
        {
          diagnostic: redactDiagnostic(record.artifactErrors),
          retryable: artifactErrorsAreRetryable(record.artifactErrors),
        },
      );
    }
    if (record.msg !== 'Repository finished') continue;
    const repository = record.repository;
    if (!expected.has(repository)) {
      throw new RenovateOutcomeError(
        'unexpected-repository',
        `Renovate completed an unexpected repository: ${repository}`,
      );
    }
    if (completed.has(repository)) {
      throw new RenovateOutcomeError(
        'duplicate-completion',
        `Renovate emitted duplicate completion for ${repository}`,
      );
    }
    if (record.result !== 'done') {
      throw new RenovateOutcomeError(
        record.result === 'lockfile-error' ? 'lockfile-error' : 'repository-result',
        `Renovate ${repository} finished with result ${record.result}`,
        {
          diagnostic: redactDiagnostic({ repository, result: record.result }),
          retryable: record.result === 'lockfile-error',
        },
      );
    }
    completed.set(repository, record.result);
  }
  const missing = repositories.filter((repository) => !completed.has(repository));
  if (missing.length > 0) {
    throw new RenovateOutcomeError(
      'missing-completion',
      `Renovate did not complete: ${missing.join(', ')}`,
      { diagnostic: redactDiagnostic(missing), retryable: true },
    );
  }
  return {
    repositories: [...completed.keys()].sort(),
    status: 'passed',
  };
}

export async function readBoundedRenovateRecords(path) {
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
    throw new Error('usage: validate-renovate-log.mjs LOG_PATH CONSUMER_MANIFEST');
  }
  const records = await readBoundedRenovateRecords(process.argv[2]);
  const repositories = await readExpectedRepositories(process.argv[3]);
  process.stdout.write(`${JSON.stringify(validateRenovateRecords(records, repositories))}\n`);
}

export async function readExpectedRepositories(path) {
  const manifest = await readConsumerManifest(path);
  return manifest.consumers.map((consumer) => consumer.repository);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const classification = error instanceof RenovateOutcomeError
      ? ` [${error.code}; retryable=${error.retryable}]`
      : '';
    const diagnostic = error instanceof RenovateOutcomeError && error.diagnostic
      ? `\n${error.diagnostic}`
      : '';
    process.stderr.write(`Renovate outcome validation failed${classification}: ${error.message}${diagnostic}\n`);
    process.exitCode = 1;
  });
}
