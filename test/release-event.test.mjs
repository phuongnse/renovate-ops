import assert from 'node:assert/strict';
import test from 'node:test';

import { validateReleaseEvent } from '../scripts/validate-release-event.mjs';


function event() {
  return {
    action: 'engineering-process-published',
    client_payload: {
      distributionDigest: `sha256:${'a'.repeat(64)}`,
      package: 'engineering-process',
      repository: 'phuongnse/engineering-process',
      tag: 'v0.2.0',
      version: '0.2.0',
    },
    repository: { full_name: 'phuongnse/renovate-ops' },
    sender: { login: 'phuongnse-renovate-ops[bot]' },
  };
}

test('release event accepts the exact App-authored publication identity', () => {
  assert.deepEqual(validateReleaseEvent(event()), event().client_payload);
});

test('release event rejects a different sender', () => {
  const candidate = event();
  candidate.sender.login = 'phuongnse';
  assert.throws(() => validateReleaseEvent(candidate), /installed Renovate GitHub App/);
});

test('release event rejects extra payload authority', () => {
  const candidate = event();
  candidate.client_payload.automerge = true;
  assert.throws(() => validateReleaseEvent(candidate), /unexpected fields/);
});

test('release event binds tag to version and distribution digest', () => {
  const wrongTag = event();
  wrongTag.client_payload.tag = 'v0.2.1';
  assert.throws(() => validateReleaseEvent(wrongTag), /tag does not match/);

  const wrongDigest = event();
  wrongDigest.client_payload.distributionDigest = 'sha256:pending';
  assert.throws(() => validateReleaseEvent(wrongDigest), /distribution digest/);
});
