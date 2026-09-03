import { spawnSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_ALLOW_SCRIPTS = Object.freeze({
  'core-js-pure': false,
  'dtrace-provider': false,
  're2@1.26.1': true,
});

const EXPECTED_INSTALL_SCRIPTS = Object.freeze({
  'node_modules/core-js-pure': Object.freeze({
    version: '3.50.0',
    resolved: 'https://registry.npmjs.org/core-js-pure/-/core-js-pure-3.50.0.tgz',
  }),
  'node_modules/dtrace-provider': Object.freeze({
    version: '0.8.8',
    resolved: 'https://registry.npmjs.org/dtrace-provider/-/dtrace-provider-0.8.8.tgz',
  }),
  'node_modules/re2': Object.freeze({
    version: '1.26.1',
    resolved: 'https://registry.npmjs.org/re2/-/re2-1.26.1.tgz',
  }),
});

function stableEntries(value) {
  return Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

export function npmCliCandidates(executable, platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const executableRoot = paths.dirname(executable);
  return platform === 'win32'
    ? [paths.join(executableRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [
        paths.join(executableRoot, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        paths.join(executableRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
}

export function isWithinNodeDistribution(distributionRoot, candidate, platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const relative = paths.relative(distributionRoot, candidate);
  return relative !== ''
    && !paths.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${paths.sep}`);
}

export async function resolveNpmCli(
  executable = process.execPath,
  platform = process.platform,
) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const canonicalExecutable = await realpath(executable);
  const distributionRoot = platform === 'win32'
    ? paths.dirname(canonicalExecutable)
    : paths.resolve(paths.dirname(canonicalExecutable), '..');
  const matches = [];
  let escaped = false;
  for (const candidate of npmCliCandidates(canonicalExecutable, platform)) {
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      const canonicalCandidate = await realpath(candidate);
      if (!isWithinNodeDistribution(distributionRoot, canonicalCandidate, platform)) {
        escaped = true;
        continue;
      }
      matches.push(canonicalCandidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (escaped) throw new Error('npm CLI escapes the native Node distribution');
  if (matches.length !== 1) {
    throw new Error(
      `expected one regular npm CLI in the native Node distribution; found ${matches.length}`,
    );
  }
  return matches[0];
}

export function validatePolicyAndLock(packageDocument, lockDocument) {
  if (JSON.stringify(stableEntries(packageDocument.allowScripts)) !==
      JSON.stringify(stableEntries(EXPECTED_ALLOW_SCRIPTS))) {
    throw new Error('package.json allowScripts must contain only the reviewed exact policy');
  }
  if (lockDocument.lockfileVersion !== 3 || typeof lockDocument.packages !== 'object') {
    throw new Error('package-lock.json must use the npm lockfileVersion 3 package inventory');
  }
  if (lockDocument.packages['']?.devDependencies?.renovate !== '44.37.1') {
    throw new Error('package lock does not bind the exact Renovate version');
  }

  const scriptEntries = Object.entries(lockDocument.packages)
    .filter(([, metadata]) => metadata?.hasInstallScript === true)
    .map(([location]) => location)
    .sort();
  const expectedLocations = Object.keys(EXPECTED_INSTALL_SCRIPTS).sort();
  if (JSON.stringify(scriptEntries) !== JSON.stringify(expectedLocations)) {
    throw new Error(
      `install-script inventory drifted: ${scriptEntries.join(', ') || '<empty>'}`,
    );
  }

  for (const [location, expected] of Object.entries(EXPECTED_INSTALL_SCRIPTS)) {
    const metadata = lockDocument.packages[location];
    if (metadata.version !== expected.version || metadata.resolved !== expected.resolved) {
      throw new Error(`${location} identity does not match the reviewed lock entry`);
    }
    if (typeof metadata.integrity !== 'string' || !metadata.integrity.startsWith('sha512-')) {
      throw new Error(`${location} lacks a SHA-512 registry integrity`);
    }
  }
}

async function validatePolicyFiles(projectRoot) {
  const packageDocument = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  );
  const lockDocument = JSON.parse(
    await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'),
  );
  validatePolicyAndLock(packageDocument, lockDocument);
}

async function requireRegularContainedPath(root, relative, { directory }) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${relative} must not traverse a symbolic link`);
    }
  }
  const metadata = await lstat(current);
  if (directory ? !metadata.isDirectory() : !metadata.isFile()) {
    throw new Error(`${relative} must be a regular ${directory ? 'directory' : 'file'}`);
  }
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(current);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${relative} escapes the project root`);
  }
  return current;
}

export async function verifyValidationRuntime(projectRoot) {
  await validatePolicyFiles(projectRoot);

  const re2Root = await requireRegularContainedPath(
    projectRoot,
    'node_modules/re2',
    { directory: true },
  );
  const re2Package = JSON.parse(await readFile(path.join(re2Root, 'package.json'), 'utf8'));
  if (re2Package.version !== '1.26.1') {
    throw new Error('installed RE2 version does not match the reviewed policy');
  }
  await requireRegularContainedPath(
    projectRoot,
    'node_modules/re2/build/Release/re2.node',
    { directory: false },
  );

  const require = createRequire(path.join(projectRoot, 'package.json'));
  const RE2 = require('re2');
  const expression = new RE2('^policy-verification$');
  if (!expression.test('policy-verification') || expression.test('fallback')) {
    throw new Error('native RE2 runtime behavior is invalid');
  }
}

export async function prepareValidationRuntime(projectRoot) {
  await validatePolicyFiles(projectRoot);
  const npmCli = await resolveNpmCli();
  const result = spawnSync(process.execPath, [npmCli, 'rebuild', 're2'], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    throw new Error(`npm rebuild re2 failed with ${outcome}`);
  }
  await verifyValidationRuntime(projectRoot);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--prepare')) {
    throw new Error('usage: verify-validation-runtime.mjs [--prepare]');
  }
  if (process.argv[2] === '--prepare') await prepareValidationRuntime(projectRoot);
  else await verifyValidationRuntime(projectRoot);
  process.stdout.write('Renovate validation runtime ready\n');
}

export { EXPECTED_ALLOW_SCRIPTS, EXPECTED_INSTALL_SCRIPTS };
