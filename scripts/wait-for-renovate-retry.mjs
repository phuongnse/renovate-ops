import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const RENOVATE_RETRY_DELAY_MS = 300_000;

export async function waitForRenovateRetry({
  delayMs = RENOVATE_RETRY_DELAY_MS,
  sleepFunction = sleep,
} = {}) {
  if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > RENOVATE_RETRY_DELAY_MS) {
    throw new Error(`retry delay must be between 1 and ${RENOVATE_RETRY_DELAY_MS} milliseconds`);
  }
  await sleepFunction(delayMs);
  return { delayMs, status: 'completed' };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForRenovateRetry()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`Renovate retry wait failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
