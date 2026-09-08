import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function validateAppName(actual, expected) {
  // GitHub owns this provider limit; a convention override cannot relax it.
  // https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
  if (typeof actual !== 'string' || actual.length < 1 || actual.length > 34) {
    throw new Error('GitHub App name must contain 1 to 34 characters');
  }
  if (actual !== expected) {
    throw new Error('GitHub App name does not match the selected automation-name convention');
  }
}

export function readNamingResult(stdout) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error('Process naming renderer returned invalid JSON');
  }
  if (result?.status !== 'passed' || result.standard?.artifact !== 'automation-name'
      || result.standard?.adapter !== 'automation-name'
      || typeof result.standard?.id !== 'string' || !result.standard.id
      || !Number.isInteger(result.standard?.version) || result.standard.version < 1
      || !/^sha256:[0-9a-f]{64}$/.test(result.standard?.digest ?? '')
      || typeof result.content !== 'string' || !result.content.endsWith('\n')
      || result.content.indexOf('\n') !== result.content.length - 1) {
    throw new Error('Process naming renderer returned an invalid name result');
  }
  return { name: result.content.slice(0, -1), standard: result.standard };
}

export async function loadAppManifest({ root = repositoryRoot, update = false } = {}) {
  const manifestPath = path.join(root, 'github-app-manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(original);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('GitHub App manifest must be an object');
  }
  const rendered = spawnSync('python', [
    '-I', '-m', 'engineering_process', 'artifact', 'render',
    '--artifact', 'automation-name', '--project-root', root,
    '--data-file', path.join(root, '.process', 'automation-name.json'), '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024, windowsHide: true });
  if (rendered.error || rendered.status !== 0) {
    throw new Error('Process naming renderer failed; install the consumer hash-locked runtime and check its naming selection');
  }
  const { name, standard } = readNamingResult(rendered.stdout);
  validateAppName(update ? name : manifest.name, name);
  let text = original;
  if (update && manifest.name !== name) {
    text = `${JSON.stringify({ ...manifest, name }, null, 2)}\n`;
    await writeFile(manifestPath, text, 'utf8');
  }
  return { name, text, standard };
}
