import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finalizeAdoptionPullRequests,
  requiredCheckOutcome,
  satisfiedAdoptionBody,
} from '../scripts/finalize-adoption-prs.mjs';

function event() {
  return {
    action: 'engineering-process-published',
    client_payload: {
      attestationDigest: `sha256:${'a'.repeat(64)}`,
      package: 'engineering-process',
      repository: 'phuongnse/engineering-process',
      tag: 'v0.2.1',
      version: '0.2.1',
    },
    repository: { full_name: 'phuongnse/renovate-ops' },
    sender: { login: 'phuongnse-renovate-ops[bot]' },
  };
}

function manifest(repository) {
  return {
    schemaVersion: 1,
    consumers: [{
      repository,
      defaultBranch: 'main',
      checkpoint: 'a'.repeat(40),
      configPath: '.github/renovate.json5',
      configSha256: `sha256:${'b'.repeat(64)}`,
    }],
  };
}

function body() {
  return `<!-- engineering-process:pr-description:start -->
## Summary
Candidate.

## Requirements and rules followed

- [ ] **Scope and contract** — accepted scope is implemented without unapproved expansion. [status: pending]
- [ ] **Verification evidence** — required current profiles pass on the published checkpoint. [status: pending]
- [ ] **Independent review** — a separate reviewer approved the published checkpoint with no open required finding. [status: pending]
<!-- engineering-process:pr-description:end -->
<!--renovate-debug:eyJ0YXJnZXRCcmFuY2giOiJtYWluIn0=-->
`;
}

function response(document, status = 200) {
  const bytes = Buffer.from(JSON.stringify(document));
  return {
    arrayBuffer: async () => bytes,
    headers: { get: (name) => (name === 'content-length' ? String(bytes.length) : null) },
    ok: status >= 200 && status < 300,
    status,
  };
}

function successRuns() {
  return {
    check_runs: [
      { app: { id: 15368 }, conclusion: 'success', id: 1, name: 'validate', status: 'completed' },
      {
        app: { id: 15368 },
        conclusion: 'success',
        id: 2,
        name: 'independent-review / independent-review',
        status: 'completed',
      },
    ],
  };
}

test('managed adoption evidence becomes satisfied without changing Renovate metadata', () => {
  const updated = satisfiedAdoptionBody(body());
  assert.equal(updated.match(/\[status: satisfied\]/g)?.length, 3);
  assert.doesNotMatch(updated, /\[status: pending\]/);
  assert.match(updated, /<!--renovate-debug:eyJ0YXJnZXRCcmFuY2giOiJtYWluIn0=-->\n$/);
  assert.equal(satisfiedAdoptionBody(updated), updated);
  assert.throws(() => satisfiedAdoptionBody('missing markers'), /managed markers/);
});

test('required checks distinguish pending and terminal failure', () => {
  const required = [
    { app_id: 15368, context: 'validate' },
    { app_id: 15368, context: 'independent-review / independent-review' },
  ];
  assert.equal(requiredCheckOutcome(required, successRuns().check_runs).passed, true);
  const pending = structuredClone(successRuns().check_runs);
  pending[0].status = 'in_progress';
  pending[0].conclusion = null;
  assert.deepEqual(requiredCheckOutcome(required, pending).pending, ['validate']);
  const failed = structuredClone(successRuns().check_runs);
  failed[0].conclusion = 'failure';
  assert.deepEqual(requiredCheckOutcome(required, failed).failed, ['validate:failure']);
});

test('finalizer binds exact PR, waits for checks, updates evidence, and marks ready', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ body: options.body, method: options.method, url });
    if (url.includes('/pulls?')) {
      return response([
        {
          base: { ref: 'main' },
          body: body(),
          draft: true,
          head: {
            ref: 'automation/renovate/engineering-process-authority',
            repo: { full_name: 'phuongnse/engineering-process' },
            sha: 'b'.repeat(40),
          },
          node_id: 'PR_node',
          number: 41,
          title: 'chore(deps): update engineering-process authority to v0.2.1',
          user: { login: 'phuongnse-renovate-ops[bot]' },
        },
      ]);
    }
    if (url.endsWith('/branches/main/protection/required_status_checks')) {
      return response({
        checks: [
          { app_id: 15368, context: 'validate' },
          { app_id: 15368, context: 'independent-review / independent-review' },
        ],
      });
    }
    if (url.includes('/check-runs?')) return response(successRuns());
    if (url.endsWith('/pulls/41') && options.method === 'PATCH') {
      assert.match(options.body, /status: satisfied/);
      return response({ number: 41 });
    }
    if (url.endsWith('/graphql')) {
      return response({
        data: { markPullRequestReadyForReview: { pullRequest: { id: 'PR_node', isDraft: false } } },
      });
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const sleeps = [];

  const result = await finalizeAdoptionPullRequests({
    event: event(),
    fetchImpl,
    manifest: manifest('phuongnse/engineering-process'),
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    token: 'installation-token-value',
  });

  assert.deepEqual(result.ready, ['phuongnse/engineering-process#41']);
  assert.deepEqual(sleeps, [20_000]);
  assert.equal(calls.filter((call) => call.url.endsWith('/graphql')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes('/check-runs?')).length, 2);
});

test('finalizer fails closed before PR mutation when a required check fails', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ method: options.method, url });
    if (url.includes('/pulls?')) {
      return response([
        {
          base: { ref: 'main' },
          body: body(),
          draft: true,
          head: {
            ref: 'automation/renovate/engineering-process-authority',
            repo: { full_name: 'phuongnse/engineering-process' },
            sha: 'b'.repeat(40),
          },
          node_id: 'PR_node',
          number: 41,
          title: 'chore(deps): update engineering-process authority to v0.2.1',
          user: { login: 'phuongnse-renovate-ops[bot]' },
        },
      ]);
    }
    if (url.endsWith('/branches/main/protection/required_status_checks')) {
      return response({ checks: [{ app_id: 15368, context: 'validate' }] });
    }
    if (url.includes('/check-runs?')) {
      return response({
        check_runs: [
          { app: { id: 15368 }, conclusion: 'failure', id: 1, name: 'validate', status: 'completed' },
        ],
      });
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };

  await assert.rejects(
    finalizeAdoptionPullRequests({
      event: event(),
      fetchImpl,
      manifest: manifest('phuongnse/engineering-process'),
      sleep: async () => {},
      token: 'installation-token-value',
    }),
    /validate:failure/,
  );
  assert.equal(calls.some((call) => call.method === 'PATCH'), false);
  assert.equal(calls.some((call) => call.url.endsWith('/graphql')), false);
});

test('repeated release events accept repositories that already adopted the exact version', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ method: options.method, url });
    if (url.includes('/pulls?')) return response([]);
    if (url.includes('/contents/requirements/process.in')) {
      return response({
        content: Buffer.from('engineering-process==0.2.1\n').toString('base64'),
        encoding: 'base64',
        type: 'file',
      });
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };

  const result = await finalizeAdoptionPullRequests({
    event: event(),
    fetchImpl,
    manifest: manifest('phuongnse/engineering-process'),
    sleep: async () => {},
    token: 'installation-token-value',
  });

  assert.deepEqual(result.alreadyAdopted, ['phuongnse/engineering-process']);
  assert.deepEqual(result.ready, []);
  assert.equal(calls.some((call) => call.method !== 'GET'), false);
});

test('operations consumer is explicitly skipped without cross-repository access', async () => {
  const result = await finalizeAdoptionPullRequests({
    event: event(),
    fetchImpl: async () => {
      throw new Error('operations skip must not call the API');
    },
    manifest: manifest('phuongnse/renovate-ops'),
    sleep: async () => {},
    token: 'installation-token-value',
  });

  assert.deepEqual(result.skipped, ['phuongnse/renovate-ops']);
  assert.deepEqual(result.ready, []);
});

test('finalizer rejects a manifest that could expose a sibling token', async () => {
  const unsafe = manifest('phuongnse/engineering-process');
  unsafe.consumers.push(manifest('phuongnse/axis').consumers[0]);
  unsafe.consumers.sort((left, right) => left.repository.localeCompare(right.repository));

  await assert.rejects(
    finalizeAdoptionPullRequests({
      event: event(),
      fetchImpl: async () => {
        throw new Error('invalid manifest must not call the API');
      },
      manifest: unsafe,
      sleep: async () => {},
      token: 'installation-token-value',
    }),
    /one exact consumer/,
  );
});
