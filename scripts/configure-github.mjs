import { chmod, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repository = 'phuongnse/renovate-ops';
const credentialPath = new URL('../.local/github-app.json', import.meta.url);
const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));

if (!/^Iv[0-9a-z.]+$/i.test(credentials.client_id ?? '')) {
  throw new Error('manifest response does not contain a valid GitHub App client_id');
}
if (!String(credentials.pem ?? '').includes('BEGIN RSA PRIVATE KEY')) {
  throw new Error('manifest response does not contain a GitHub App private key');
}

function runGh(args, input) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

runGh([
  'variable',
  'set',
  'RENOVATE_APP_CLIENT_ID',
  '--repo',
  repository,
  '--body',
  credentials.client_id,
]);
runGh([
  'variable',
  'set',
  'RENOVATE_ENABLED',
  '--repo',
  repository,
  '--body',
  'false',
]);
runGh([
  'secret',
  'set',
  'RENOVATE_APP_PRIVATE_KEY',
  '--repo',
  repository,
], credentials.pem);

const installUrl = `https://github.com/apps/${credentials.slug}/installations/new`;
await chmod(credentialPath, 0o600);
await rm(credentialPath);

process.stdout.write('Configured RENOVATE_APP_CLIENT_ID and RENOVATE_APP_PRIVATE_KEY.\n');
process.stdout.write('Kept RENOVATE_ENABLED=false until the hosted-to-self-hosted cutover.\n');
process.stdout.write('Deleted the local manifest credential response.\n');
process.stdout.write(`Install or review repository access: ${installUrl}\n`);
