import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isWithinNodeDistribution,
  npmCliCandidates,
  resolveNpmCli,
  validatePolicyAndLock,
  verifyValidationRuntime,
} from '../scripts/verify-validation-runtime.mjs';

const root = new URL('../', import.meta.url);
const packageDocument = JSON.parse(await readFile(new URL('package.json', root)));
const lockDocument = JSON.parse(await readFile(new URL('package-lock.json', root)));

test('npm CLI paths derive only from the native Node distribution', async () => {
  assert.deepEqual(
    npmCliCandidates('C:\\node\\node.exe', 'win32'),
    ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js'],
  );
  assert.deepEqual(
    npmCliCandidates('/opt/node/bin/node', 'linux'),
    [
      '/opt/node/lib/node_modules/npm/bin/npm-cli.js',
      '/opt/node/bin/node_modules/npm/bin/npm-cli.js',
    ],
  );
  assert.equal(
    isWithinNodeDistribution(
      'C:\\node',
      'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
      'win32',
    ),
    true,
  );
  assert.equal(
    isWithinNodeDistribution('C:\\node', 'D:\\outside\\npm-cli.js', 'win32'),
    false,
  );
  assert.equal(
    isWithinNodeDistribution('/opt/node', '/opt/node/lib/node_modules/npm/bin/npm-cli.js', 'linux'),
    true,
  );
  assert.equal(
    isWithinNodeDistribution('/opt/node', '/opt/outside/npm-cli.js', 'linux'),
    false,
  );
  assert.ok((await resolveNpmCli()).endsWith('npm-cli.js'));
});

test('npm CLI resolver rejects a linked parent escape', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'renovate-npm-cli-'));
  const distributionRoot = path.join(temporaryRoot, 'node');
  const outsideRoot = path.join(temporaryRoot, 'outside');
  if (process.platform === 'win32') {
    const executable = path.join(distributionRoot, 'node.exe');
    const outsideModules = path.join(outsideRoot, 'node_modules');
    await mkdir(path.join(outsideModules, 'npm', 'bin'), { recursive: true });
    await mkdir(distributionRoot, { recursive: true });
    await writeFile(executable, '');
    await writeFile(path.join(outsideModules, 'npm', 'bin', 'npm-cli.js'), '');
    await symlink(outsideModules, path.join(distributionRoot, 'node_modules'), 'junction');
    await assert.rejects(resolveNpmCli(executable), /escapes the native Node distribution/);
  } else {
    const executable = path.join(distributionRoot, 'bin', 'node');
    const outsideLibrary = path.join(outsideRoot, 'lib');
    await mkdir(path.join(distributionRoot, 'bin'), { recursive: true });
    await mkdir(path.join(outsideLibrary, 'node_modules', 'npm', 'bin'), { recursive: true });
    await writeFile(executable, '');
    await writeFile(path.join(outsideLibrary, 'node_modules', 'npm', 'bin', 'npm-cli.js'), '');
    await symlink(outsideLibrary, path.join(distributionRoot, 'lib'), 'dir');
    await assert.rejects(resolveNpmCli(executable), /escapes the native Node distribution/);
  }
});

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
