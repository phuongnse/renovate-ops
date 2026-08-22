import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAX_EVENT_BYTES = 1_000_000;
const PAYLOAD_KEYS = ['attestationDigest', 'package', 'repository', 'tag', 'version'];
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function validateReleaseEvent(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('repository dispatch event must be a JSON object');
  }
  if (document.action !== 'engineering-process-published') {
    throw new Error('unexpected repository dispatch action');
  }
  if (document.repository?.full_name !== 'phuongnse/renovate-ops') {
    throw new Error('event targets an unexpected repository');
  }
  if (document.sender?.login !== 'phuongnse-renovate-ops[bot]') {
    throw new Error('event sender is not the installed Renovate GitHub App');
  }
  const payload = document.client_payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('release event payload must be a JSON object');
  }
  if (JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(PAYLOAD_KEYS)) {
    throw new Error('release event payload has unexpected fields');
  }
  if (payload.repository !== 'phuongnse/engineering-process') {
    throw new Error('release event has an unexpected publisher repository');
  }
  if (payload.package !== 'engineering-process') {
    throw new Error('release event has an unexpected package');
  }
  if (typeof payload.version !== 'string' || !VERSION_PATTERN.test(payload.version)) {
    throw new Error('release event has an invalid version');
  }
  if (payload.tag !== `v${payload.version}`) {
    throw new Error('release event tag does not match its version');
  }
  if (
    typeof payload.attestationDigest !== 'string'
    || !DIGEST_PATTERN.test(payload.attestationDigest)
  ) {
    throw new Error('release event has an invalid attestation digest');
  }
  return payload;
}

async function main() {
  const eventPath = process.argv[2];
  if (process.argv.length !== 3 || !eventPath) {
    throw new Error('usage: validate-release-event.mjs EVENT_PATH');
  }
  const before = await lstat(eventPath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_EVENT_BYTES) {
    throw new Error('repository dispatch event must be a bounded regular file');
  }
  const content = await readFile(eventPath);
  const after = await lstat(eventPath);
  if (
    content.length !== before.size
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
    || after.mode !== before.mode
  ) {
    throw new Error('repository dispatch event changed while reading');
  }
  const payload = validateReleaseEvent(JSON.parse(content.toString('utf8')));
  process.stdout.write(`${JSON.stringify({ status: 'passed', ...payload })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`release event validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
