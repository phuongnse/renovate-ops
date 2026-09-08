import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadAppManifest, readNamingResult, validateAppName } from '../scripts/app-name.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const standard = { id: 'process.automation-name', version: 1, digest: `sha256:${'a'.repeat(64)}`, artifact: 'automation-name', adapter: 'automation-name' };

test('provider name constraints and convention equality are independent', () => {
  validateAppName('acme-bot', 'acme-bot');
  validateAppName('a'.repeat(34), 'a'.repeat(34));
  for (const name of ['', null, 'a'.repeat(35)]) {
    assert.throws(() => validateAppName(name, name), /1 to 34/);
  }
  assert.throws(() => validateAppName('another-bot', 'acme-bot'), /selected automation-name/);
});

test('renderer failures and malformed provenance cannot claim a checked name', () => {
  const valid = { status: 'passed', standard, content: 'acme-bot\n' };
  assert.equal(readNamingResult(JSON.stringify(valid)).name, 'acme-bot');
  for (const value of [null, {}, { ...valid, status: 'failed' }, { ...valid, content: 'acme-bot' }, { ...valid, content: 'acme\nbot\n' }, { ...valid, standard: { ...standard, digest: undefined } }, { ...valid, standard: { ...standard, adapter: 'pr-description' } }]) {
    assert.throws(() => readNamingResult(JSON.stringify(value)), /invalid name result/);
  }
  assert.throws(() => readNamingResult('invalid'), /invalid JSON/);
});

test('installed renderer checks real manifests and supported consumer overrides', async (context) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'app-naming-'));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, '.process'));
  await writeFile(path.join(fixture, '.process', 'automation-name.json'), JSON.stringify({ schemaVersion: 1, components: { owner: 'Acme', role: 'Dependency-Updates' } }));
  const manifestPath = path.join(fixture, 'github-app-manifest.json');
  const original = { name: 'wrong-name', default_permissions: { contents: 'read' } };
  await writeFile(manifestPath, JSON.stringify(original));
  await assert.rejects(loadAppManifest({ root: fixture }), /selected automation-name/);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), original);
  const updated = await loadAppManifest({ root: fixture, update: true });
  assert.equal(updated.name, 'acme-dependency-updates');
  assert.deepEqual(JSON.parse(updated.text).default_permissions, original.default_permissions);
  assert.equal((await loadAppManifest({ root: fixture })).text, updated.text);

  const git = spawnSync('git', ['init', '-q', fixture], { timeout: 10_000, encoding: 'utf8', windowsHide: true });
  assert.equal(git.status, 0);
  const exported = spawnSync('python', ['-I', '-m', 'engineering_process', 'artifact', 'show', '--artifact', 'automation-name', '--json'], { cwd: fixture, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024, windowsHide: true });
  assert.equal(exported.status, 0);
  const definition = JSON.parse(exported.stdout).definition;
  definition.id = 'consumer.app-name';
  definition.rules.components.reverse();
  await writeFile(path.join(fixture, '.process', 'name-standard.json'), JSON.stringify(definition));
  await writeFile(path.join(fixture, '.process', 'standards.json'), JSON.stringify({ schemaVersion: 1, artifacts: { 'automation-name': { path: '.process/name-standard.json' } } }));
  await assert.rejects(loadAppManifest({ root: fixture }), /selected automation-name/);
  assert.equal((await loadAppManifest({ root: fixture, update: true })).name, 'dependency-updates-acme');
  assert.equal((await loadAppManifest({ root: fixture })).standard.id, 'consumer.app-name');
});

test('name drift stops bootstrap and configuration before their side effects', async (context) => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'app-naming-entry-'));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, 'scripts'));
  await mkdir(path.join(fixture, '.process'));
  await writeFile(path.join(fixture, '.process', 'automation-name.json'), JSON.stringify({ schemaVersion: 1, components: { owner: 'acme', role: 'bot' } }));
  await writeFile(path.join(fixture, 'github-app-manifest.json'), JSON.stringify({ name: 'wrong-name' }));
  for (const file of ['app-name.mjs', 'github-app-manifest-server.mjs', 'configure-github.mjs']) {
    await copyFile(path.join(root, 'scripts', file), path.join(fixture, 'scripts', file));
  }
  // No credential file exists, so even an ordering regression cannot configure GitHub.
  for (const script of ['github-app-manifest-server.mjs', 'configure-github.mjs']) {
    const result = spawnSync(process.execPath, [path.join(fixture, 'scripts', script)], { cwd: fixture, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match the selected automation-name/);
    assert.doesNotMatch(result.stdout, /Open http|Configured RENOVATE/);
  }
});
