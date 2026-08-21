import { readFile } from 'node:fs/promises';

const repositories = JSON.parse(
  await readFile(new URL('../repositories.json', import.meta.url), 'utf8'),
);

if (!Array.isArray(repositories) || repositories.length === 0) {
  throw new Error('repositories.json must contain at least one repository');
}

const seen = new Set();
for (const repository of repositories) {
  if (!/^phuongnse\/[a-z0-9._-]+$/i.test(repository)) {
    throw new Error(`invalid or untrusted repository: ${repository}`);
  }
  if (seen.has(repository)) {
    throw new Error(`duplicate repository: ${repository}`);
  }
  seen.add(repository);
}

const delimiter = 'RENOVATE_REPOSITORIES_EOF';
process.stdout.write(`repositories<<${delimiter}\n`);
process.stdout.write(`${repositories.join('\n')}\n`);
process.stdout.write(`${delimiter}\n`);
