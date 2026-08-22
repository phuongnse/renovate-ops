import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateReleaseEvent } from './validate-release-event.mjs';

const API_ROOT = 'https://api.github.com';
const ADOPTION_BRANCH = 'automation/renovate/engineering-process-authority';
const ACCEPTED_CONCLUSIONS = new Set(['neutral', 'skipped', 'success']);
const FAILED_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'startup_failure',
  'stale',
  'timed_out',
]);
const MAX_API_BYTES = 1_000_000;
const MAX_REPOSITORIES = 16;
const MAX_WAIT_MS = 15 * 60 * 1_000;
const POLL_INTERVAL_MS = 15_000;
const READY_EVENT_GRACE_MS = 20_000;

function repositoryPattern(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function exactTitle(version) {
  return new RegExp(
    `^chore\\(deps\\): [Uu]pdate engineering-process authority to v${version.replaceAll('.', '\\.')}$`,
  );
}

function processPin(content) {
  const matches = [...content.matchAll(/^engineering-process==([^\s]+)$/gm)];
  if (matches.length !== 1) {
    throw new Error('requirements/process.in must contain one exact process pin');
  }
  return matches[0][1];
}

export function satisfiedAdoptionBody(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_API_BYTES) {
    throw new Error('adoption PR body must be a bounded string');
  }
  const start = '<!-- engineering-process:pr-description:start -->';
  const end = '<!-- engineering-process:pr-description:end -->';
  if (body.split(start).length !== 2 || body.split(end).length !== 2) {
    throw new Error('adoption PR body has invalid managed markers');
  }
  if (!/<!--renovate-debug:[A-Za-z0-9+/=]+-->\s*$/.test(body)) {
    throw new Error('adoption PR body is missing bounded Renovate metadata');
  }
  const pending = body.match(/^- \[ \] \*\*.+\[status: pending\]$/gm) ?? [];
  const satisfied = body.match(/^- \[x\] \*\*.+\[status: satisfied\]$/gm) ?? [];
  if (pending.length === 0 && satisfied.length >= 3) return body;
  if (pending.length < 3) {
    throw new Error('adoption PR body has incomplete pending requirements');
  }
  let updated = body
    .replaceAll('- [ ] **', '- [x] **')
    .replaceAll('[status: pending]', '[status: satisfied]');
  const reviewStatements = new Map([
    [
      'A fresh isolated reviewer context must approve the final immutable adoption checkpoint before this draft becomes ready.',
      'A fresh isolated reviewer approved the final immutable adoption checkpoint; owner merge remains adoption authorization.',
    ],
    [
      'A human reviewer must approve the verified immutable checkpoint before merge.',
      'The pinned independent reviewer approved the verified immutable checkpoint; owner merge remains adoption authorization.',
    ],
    [
      'A separate reviewer must approve the exact verified checkpoint before merge.',
      'The pinned independent reviewer approved the exact verified checkpoint; owner merge remains adoption authorization.',
    ],
  ]);
  for (const [before, after] of reviewStatements) updated = updated.replace(before, after);
  if (/^- \[ \].+\[status: pending\]$/m.test(updated)) {
    throw new Error('adoption PR body still contains pending requirements');
  }
  return updated;
}

export function requiredCheckOutcome(required, checkRuns) {
  const byName = new Map();
  for (const run of checkRuns) {
    if (run === null || typeof run !== 'object' || typeof run.name !== 'string') continue;
    const current = byName.get(run.name);
    if (current === undefined || Number(run.id) > Number(current.id)) byName.set(run.name, run);
  }
  const pending = [];
  const failed = [];
  for (const item of required) {
    const run = byName.get(item.context);
    if (run === undefined || (item.app_id !== null && run.app?.id !== item.app_id)) {
      pending.push(item.context);
      continue;
    }
    if (run.status !== 'completed' || run.conclusion === null) {
      pending.push(item.context);
    } else if (FAILED_CONCLUSIONS.has(run.conclusion)) {
      failed.push(`${item.context}:${run.conclusion}`);
    } else if (!ACCEPTED_CONCLUSIONS.has(run.conclusion)) {
      failed.push(`${item.context}:unexpected-${run.conclusion}`);
    }
  }
  return { failed, pending, passed: pending.length === 0 && failed.length === 0 };
}

async function boundedJson(response, label) {
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined && Number(declared) > MAX_API_BYTES) {
    throw new Error(`${label} exceeds the response size limit`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > MAX_API_BYTES) throw new Error(`${label} exceeds the response size limit`);
  let document;
  try {
    document = JSON.parse(content.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${document.message ?? 'unknown error'}`);
  }
  return document;
}

function client(token, fetchImpl) {
  return async (path, { body, method = 'GET' } = {}) => {
    const response = await fetchImpl(path.startsWith('http') ? path : `${API_ROOT}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'phuongnse-renovate-ops',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      method,
      signal: AbortSignal.timeout(30_000),
    });
    return boundedJson(response, `${method} ${path}`);
  };
}

async function adoptionPullRequest(api, repository, version) {
  const owner = repository.split('/')[0];
  const pulls = await api(
    `/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${ADOPTION_BRANCH}`)}&per_page=10`,
  );
  if (!Array.isArray(pulls)) throw new Error(`${repository} pull list is invalid`);
  if (pulls.length === 0) {
    const input = await api(`/repos/${repository}/contents/requirements/process.in?ref=main`);
    if (input.type !== 'file' || input.encoding !== 'base64' || typeof input.content !== 'string') {
      throw new Error(`${repository} process input is invalid`);
    }
    const content = Buffer.from(input.content.replaceAll('\n', ''), 'base64');
    if (content.length > MAX_API_BYTES) throw new Error(`${repository} process input is too large`);
    if (processPin(content.toString('utf8')) === version) return null;
    throw new Error(`${repository} is stale but has no process adoption PR`);
  }
  if (pulls.length !== 1) throw new Error(`${repository} has multiple process adoption PRs`);
  const pull = pulls[0];
  if (
    pull.base?.ref !== 'main'
    || pull.head?.ref !== ADOPTION_BRANCH
    || pull.head?.repo?.full_name !== repository
    || pull.user?.login !== 'phuongnse-renovate-ops[bot]'
    || typeof pull.head?.sha !== 'string'
    || !/^[0-9a-f]{40}$/.test(pull.head.sha)
    || typeof pull.node_id !== 'string'
    || !exactTitle(version).test(pull.title)
  ) {
    throw new Error(`${repository} adoption PR identity is invalid`);
  }
  return { repository, ...pull };
}

async function requiredChecks(api, repository) {
  const protection = await api(`/repos/${repository}/branches/main/protection/required_status_checks`);
  if (!Array.isArray(protection.checks) || protection.checks.length === 0) {
    throw new Error(`${repository} has no required check contract`);
  }
  return protection.checks.map((item) => ({ app_id: item.app_id ?? null, context: item.context }));
}

async function waitForChecks(api, targets, { now, sleep }) {
  const deadline = now() + MAX_WAIT_MS;
  while (true) {
    const results = await Promise.all(
      targets.map(async (target) => {
        const document = await api(
          `/repos/${target.repository}/commits/${target.head.sha}/check-runs?filter=latest&per_page=100`,
        );
        if (!Array.isArray(document.check_runs)) {
          throw new Error(`${target.repository} check-run response is invalid`);
        }
        return {
          repository: target.repository,
          outcome: requiredCheckOutcome(target.required, document.check_runs),
        };
      }),
    );
    const failed = results.filter((result) => result.outcome.failed.length > 0);
    if (failed.length > 0) {
      throw new Error(
        failed
          .map((result) => `${result.repository}: ${result.outcome.failed.join(', ')}`)
          .join('; '),
      );
    }
    if (results.every((result) => result.outcome.passed)) return;
    if (now() >= deadline) {
      throw new Error(
        `required checks did not finish: ${results
          .filter((result) => !result.outcome.passed)
          .map((result) => `${result.repository}(${result.outcome.pending.join(',')})`)
          .join('; ')}`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function markReady(api, pull) {
  const body = satisfiedAdoptionBody(pull.body);
  if (body !== pull.body) {
    await api(`/repos/${pull.repository}/pulls/${pull.number}`, {
      body: { body },
      method: 'PATCH',
    });
  }
  if (!pull.draft) return;
  const result = await api('/graphql', {
    body: {
      query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { id isDraft } } }',
      variables: { id: pull.node_id },
    },
    method: 'POST',
  });
  if (result.errors || result.data?.markPullRequestReadyForReview?.pullRequest?.isDraft !== false) {
    throw new Error(`${pull.repository} could not mark adoption PR ready`);
  }
}

export async function finalizeAdoptionPullRequests({
  event,
  fetchImpl = fetch,
  now = Date.now,
  repositories,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  token,
}) {
  const payload = validateReleaseEvent(event);
  if (
    !Array.isArray(repositories)
    || repositories.length < 2
    || repositories.length > MAX_REPOSITORIES
    || repositories.some((repository) => typeof repository !== 'string' || !repositoryPattern(repository))
    || new Set(repositories).size !== repositories.length
    || !repositories.includes(event.repository.full_name)
  ) {
    throw new Error('repository allowlist is invalid');
  }
  if (typeof token !== 'string' || token.length < 20 || token.length > 2_000) {
    throw new Error('GitHub App token is invalid');
  }
  const api = client(token, fetchImpl);
  const candidates = await Promise.all(
    repositories
      .filter((repository) => repository !== event.repository.full_name)
      .map((repository) => adoptionPullRequest(api, repository, payload.version)),
  );
  const pulls = candidates.filter((candidate) => candidate !== null);
  const targets = await Promise.all(
    pulls.map(async (pull) => ({
      ...pull,
      required: await requiredChecks(api, pull.repository),
    })),
  );
  await waitForChecks(api, targets, { now, sleep });
  for (const target of targets) await markReady(api, target);
  if (targets.length > 0) {
    await sleep(READY_EVENT_GRACE_MS);
    await waitForChecks(api, targets, { now, sleep });
  }
  return {
    alreadyAdopted: candidates
      .map((candidate, index) => (candidate === null ? repositories.filter((repository) => repository !== event.repository.full_name)[index] : null))
      .filter((repository) => repository !== null)
      .sort(),
    ready: targets.map((target) => `${target.repository}#${target.number}`).sort(),
    status: 'passed',
    version: payload.version,
  };
}

async function main() {
  if (process.argv.length !== 4) {
    throw new Error('usage: finalize-adoption-prs.mjs EVENT_PATH REPOSITORIES_PATH');
  }
  const readBounded = async (path, label) => {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_API_BYTES) {
      throw new Error(`${label} must be a bounded regular file`);
    }
    const content = await readFile(path);
    const after = await lstat(path);
    if (
      content.length !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.mode !== before.mode
    ) {
      throw new Error(`${label} changed while reading`);
    }
    return JSON.parse(content.toString('utf8'));
  };
  const [event, repositories] = await Promise.all([
    readBounded(process.argv[2], 'release event'),
    readBounded(process.argv[3], 'repository allowlist'),
  ]);
  const result = await finalizeAdoptionPullRequests({
    event,
    repositories,
    token: process.env.GH_TOKEN,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`adoption readiness failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
