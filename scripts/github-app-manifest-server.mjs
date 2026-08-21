import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const host = '127.0.0.1';
const port = 38917;
const manifestPath = new URL('../github-app-manifest.json', import.meta.url);
const credentialDirectory = new URL('../.local/', import.meta.url);
const credentialPath = new URL('github-app.json', credentialDirectory);
const manifest = await readFile(manifestPath, 'utf8');
const state = randomBytes(32).toString('hex');

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com",
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function hasValidState(candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(state, 'utf8');
  const received = Buffer.from(candidate, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  if (request.method === 'GET' && url.pathname === '/') {
    send(response, 200, `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <title>Create Renovate GitHub App</title>
  <style>body{font:16px system-ui;max-width:46rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.7rem 1rem}</style>
  <h1>Create the private Renovate GitHub App</h1>
  <p>GitHub will show the exact permissions from the version-controlled manifest before creating the app.</p>
  <form method="post" action="https://github.com/settings/apps/new?state=${state}">
    <input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
    <button type="submit">Review and create GitHub App</button>
  </form>
</html>`);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/callback') {
    if (!hasValidState(url.searchParams.get('state'))) {
      send(response, 400, '<h1>Invalid manifest flow state</h1>');
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      send(response, 400, '<h1>Missing one-time manifest code</h1>');
      return;
    }

    try {
      const conversion = await fetch(
        `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'phuongnse-renovate-ops-bootstrap',
            'X-GitHub-Api-Version': '2026-03-10',
          },
        },
      );
      const payload = await conversion.json();
      if (!conversion.ok) {
        throw new Error(`GitHub returned ${conversion.status}: ${JSON.stringify(payload)}`);
      }

      await mkdir(credentialDirectory, { recursive: true, mode: 0o700 });
      await writeFile(credentialPath, `${JSON.stringify(payload, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      });
      await chmod(credentialPath, 0o600);

      const installUrl = `https://github.com/apps/${payload.slug}/installations/new`;
      process.stdout.write(`GitHub App created: ${payload.slug}\n`);
      process.stdout.write(`Install URL: ${installUrl}\n`);
      process.stdout.write('Credentials captured at .local/github-app.json (mode 0600).\n');
      send(response, 200, `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <title>Renovate GitHub App created</title>
  <h1>GitHub App created</h1>
  <p>Return to the terminal. The next bootstrap command will store the private key in GitHub Actions and delete the local credential file.</p>
  <p><a href="${escapeHtml(installUrl)}">Install the app on the selected repositories</a></p>
</html>`);
      setTimeout(() => server.close(), 250);
    } catch (error) {
      process.stderr.write(`${error.stack ?? error}\n`);
      send(response, 500, `<h1>App creation failed</h1><pre>${escapeHtml(String(error))}</pre>`);
    }
    return;
  }

  send(response, 404, '<h1>Not found</h1>');
});
server.listen(port, host, () => {
  process.stdout.write(`Open http://${host}:${port}/ in your browser.\n`);
});
