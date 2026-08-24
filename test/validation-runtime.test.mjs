import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validatePolicyAndLock,
  verifyValidationRuntime,
} from '../scripts/verify-validation-runtime.mjs';

const root = new URL('../', import.meta.url);
const packageDocument = JSON.parse(await readFile(new URL('package.json', root)));
const lockDocument = JSON.parse(await readFile(new URL('package-lock.json', root)));

test('install-script policy exactly covers the locked inventory', () => {
  assert.doesNotThrow(() => validatePolicyAndLock(packageDocument, lockDocument));
});

test('install-script policy rejects approval and inventory drift', () => {
  const approvedUnrelated = structuredClone(packageDocument);
  approvedUnrelated.allowScripts['dtrace-provider'] = true;
  assert.throws(
    () => validatePolicyAndLock(approvedUnrelated, lockDocument),
    /reviewed exact policy/,
  );

  const floatingRe2 = structuredClone(packageDocument);
  floatingRe2.allowScripts.re2 = true;
  delete floatingRe2.allowScripts['re2@1.26.1'];
  assert.throws(
    () => validatePolicyAndLock(floatingRe2, lockDocument),
    /reviewed exact policy/,
  );

  const additionalScript = structuredClone(lockDocument);
  additionalScript.packages['node_modules/unreviewed'] = {
    version: '1.0.0',
    resolved: 'https://registry.npmjs.org/unreviewed/-/unreviewed-1.0.0.tgz',
    integrity: 'sha512-sentinel',
    hasInstallScript: true,
  };
  assert.throws(
    () => validatePolicyAndLock(packageDocument, additionalScript),
    /inventory drifted/,
  );
});

test('installed validation runtime is exact, native, and functional', async () => {
  await assert.doesNotReject(verifyValidationRuntime(fileURLToPath(root)));
});
