import { loadAppManifest } from './app-name.mjs';

if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--write')) {
  throw new Error('usage: check-app-name.mjs [--write]');
}
const result = await loadAppManifest({ update: process.argv[2] === '--write' });
process.stdout.write(`App naming: PASSED; ${result.standard.id}@${result.standard.version} ${result.standard.digest}\n`);
