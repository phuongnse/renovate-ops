import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  readBoundedRenovateRecords,
  readRenovateRepositories,
  RenovateOutcomeError,
  validateRenovateRecords,
} from './validate-renovate-log.mjs';

export function classifyRenovateRecords(records, repositories) {
  try {
    return {
      classification: 'complete',
      result: validateRenovateRecords(records, repositories),
      status: 'passed',
    };
  } catch (error) {
    if (!(error instanceof RenovateOutcomeError) || !error.retryable) throw error;
    return {
      classification: error.code,
      diagnostic: error.diagnostic,
      message: error.message,
      status: 'retryable',
    };
  }
}

async function main() {
  if (process.argv.length !== 4) {
    throw new Error('usage: classify-renovate-log.mjs LOG_PATH REPOSITORIES_PATH');
  }
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('GITHUB_OUTPUT is required');
  const result = classifyRenovateRecords(
    await readBoundedRenovateRecords(process.argv[2]),
    await readRenovateRepositories(process.argv[3]),
  );
  await appendFile(
    output,
    `status=${result.status}\nclassification=${result.classification}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Renovate first-attempt classification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
