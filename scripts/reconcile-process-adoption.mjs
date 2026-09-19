import { pathToFileURL } from 'node:url';

import { githubClient, RENOVATE_BRANCH_PREFIX } from './discover-consumers.mjs';
import {
  fileAt,
  isOlderFinalVersion,
  processBinding,
  validateCandidate,
} from './validate-process-adoption-result.mjs';
import { manifestForConsumer, MAX_MANIFEST_BYTES } from './validate-consumer-manifest.mjs';

const MAX_OPEN_PULLS = 100;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const SHA = /^[0-9a-f]{40}$/;
const PROCESS_BRANCH_NAME = /^(?:engineering-process|major-engineering-process)(?:-v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))?$/;

function isProcessAdoptionBranch(ref) {
  return typeof ref === 'string'
    && ref.startsWith(RENOVATE_BRANCH_PREFIX)
    && PROCESS_BRANCH_NAME.test(ref.slice(RENOVATE_BRANCH_PREFIX.length));
}

function parseConsumer(encoded) {
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_MANIFEST_BYTES) {
    throw new Error('RENOVATE_CONSUMER_JSON must be a bounded string');
  }
  try {
    return manifestForConsumer(JSON.parse(encoded)).consumers[0];
  } catch (error) {
    throw new Error(`RENOVATE_CONSUMER_JSON is invalid: ${error.message}`);
  }
}

function validateReleaseVersion(releaseVersion) {
  if (!SEMVER.test(releaseVersion)) throw new Error('release version must be final SemVer');
}

function ownedPullRequest(pull, consumer) {
  if (
    pull === null
    || typeof pull !== 'object'
    || typeof pull.head?.ref !== 'string'
    || (pull.head.repo !== null && typeof pull.head.repo?.full_name !== 'string')
  ) {
    throw new Error(`${consumer.repository} returned malformed pull request metadata`);
  }
  if (
    !isProcessAdoptionBranch(pull.head.ref)
    || pull.head.repo?.full_name !== consumer.repository
  ) return null;
  if (!SHA.test(pull.head.sha)) {
    throw new Error(`${consumer.repository} pull request must have an immutable head SHA`);
  }
  return {
    headSha: pull.head.sha,
    headRef: pull.head.ref,
    pull,
  };
}

function validateAdoptionPullRequest(pull, consumer, { requireCurrentCheckpoint = true } = {}) {
  if (
    !Number.isSafeInteger(pull.number)
    || pull.number < 1
    || pull.number > 2_147_483_647
    || pull.state !== 'open'
    || pull.draft !== true
    || !SHA.test(pull.head.sha)
    || pull.base?.ref !== consumer.defaultBranch
    || !SHA.test(pull.base?.sha)
    || (requireCurrentCheckpoint && pull.base.sha !== consumer.checkpoint)
    || pull.base?.repo?.full_name !== consumer.repository
  ) {
    throw new Error(`${consumer.repository} adoption pull request is not one exact open draft`);
  }
  return {
    number: pull.number,
    headSha: pull.head.sha,
    headRef: pull.head.ref,
    pull,
  };
}

async function inspectCandidate(api, consumer, pull, releaseVersion) {
  const source = await fileAt(
    api,
    consumer.repository,
    'requirements/process.in',
    pull.headSha,
    { allowNotFound: true },
  );
  if (source === null) return null;
  const binding = processBinding(source.text, {
    compiled: false,
    label: `${consumer.repository}/requirements/process.in@${pull.headSha}`,
    allowAbsent: true,
  });
  if (binding === null) return null;
  if (!SEMVER.test(binding.version)) {
    throw new Error(`${consumer.repository} candidate process source must pin final SemVer`);
  }
  await validateCandidate(api, consumer.repository, pull.headSha, binding.version);
  const classification = binding.version === releaseVersion
    ? 'exact'
    : isOlderFinalVersion(binding.version, releaseVersion)
      ? 'stale'
      : null;
  if (classification === null) {
    throw new Error(
      `${consumer.repository} candidate process source must not be newer than release ${releaseVersion}`,
    );
  }
  const adoptionPull = validateAdoptionPullRequest(pull.pull, consumer, {
    requireCurrentCheckpoint: classification === 'exact',
  });
  return { ...adoptionPull, version: binding.version, classification };
}

function staleComment(candidate, releaseVersion) {
  return [
    `engineering-process ${candidate.version} is superseded by release ${releaseVersion}.`,
    'This stale Renovate adoption pull request is being closed by the release recovery preflight.',
  ].join(' ');
}

async function reconcileCandidate(api, consumer, candidate, releaseVersion) {
  await api(
    `/repos/${consumer.repository}/issues/${candidate.number}/comments`,
    {
      method: 'POST',
      body: { body: staleComment(candidate, releaseVersion) },
    },
  );
  await api(
    `/repos/${consumer.repository}/git/refs/heads/${encodeURIComponent(candidate.headRef)}`,
    { method: 'DELETE', allowNotFound: true },
  );
  const closed = await api(
    `/repos/${consumer.repository}/pulls/${candidate.number}`,
    { method: 'PATCH', body: { state: 'closed' } },
  );
  if (closed?.state !== 'closed') {
    throw new Error(`${consumer.repository} adoption pull request did not close after reconciliation`);
  }
  return {
    number: candidate.number,
    branch: candidate.headRef,
    previousVersion: candidate.version,
  };
}

export async function reconcileProcessAdoption({
  consumer,
  fetchImpl = fetch,
  releaseVersion,
  token,
}) {
  const expected = manifestForConsumer(consumer).consumers[0];
  validateReleaseVersion(releaseVersion);
  const api = githubClient(token, fetchImpl);
  const mainSource = await fileAt(
    api,
    expected.repository,
    'requirements/process.in',
    expected.checkpoint,
  );
  const mainBinding = processBinding(mainSource.text, {
    compiled: false,
    label: `${expected.repository}/requirements/process.in@${expected.checkpoint}`,
  });
  if (!SEMVER.test(mainBinding.version)) {
    throw new Error(`${expected.repository} main process source must pin final SemVer`);
  }
  if (isOlderFinalVersion(releaseVersion, mainBinding.version)) {
    throw new Error(
      `${expected.repository} main process source is newer than release ${releaseVersion}`,
    );
  }

  const base = encodeURIComponent(expected.defaultBranch);
  const pulls = await api(
    `/repos/${expected.repository}/pulls?state=open&base=${base}&per_page=${MAX_OPEN_PULLS}`,
  );
  if (!Array.isArray(pulls) || pulls.length >= MAX_OPEN_PULLS) {
    throw new Error(`${expected.repository} open pull-request listing exceeds bounded discovery`);
  }

  const candidates = [];
  for (const pull of pulls) {
    const owned = ownedPullRequest(pull, expected);
    if (owned === null) continue;
    const candidate = await inspectCandidate(
      api,
      expected,
      owned,
      releaseVersion,
    );
    if (candidate !== null) candidates.push(candidate);
  }
  const exact = candidates.filter(({ classification }) => classification === 'exact');
  const stale = candidates.filter(({ classification }) => classification === 'stale');
  if (exact.length > 1 || stale.length > 1) {
    throw new Error(`${expected.repository} has ambiguous process adoption candidates`);
  }
  if (stale.length === 0) {
    return {
      repository: expected.repository,
      status: 'nothing-to-reconcile',
      reconciled: [],
    };
  }
  const reconciled = [
    await reconcileCandidate(api, expected, stale[0], releaseVersion),
  ];
  return {
    repository: expected.repository,
    status: 'reconciled',
    reconciled,
  };
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error('usage: reconcile-process-adoption.mjs');
  }
  const result = await reconcileProcessAdoption({
    consumer: parseConsumer(process.env.RENOVATE_CONSUMER_JSON),
    releaseVersion: process.env.RELEASE_VERSION,
    token: process.env.GH_TOKEN,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`process adoption reconciliation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
