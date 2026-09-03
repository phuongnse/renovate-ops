import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parseDocument } from 'yaml';

import {
  ADOPTION_ALLOWED_COMMAND,
  classifyProcessAdoptionRule,
} from './process-adoption-contract.mjs';

const maximumChangedFiles = 1_000;
const maximumReviewedBlobBytes = 2_000_000;
const maximumAggregateBytes = 25_000_000;
const sharedPolicyCallerName = 'Policy verification';
const sharedPolicyCalleeName = 'Shared policy';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`missing ${name}`);
  }
  return process.argv[index + 1];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function git(root, args, options = {}) {
  return run('git', args, { cwd: root, ...options });
}

function assertSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? '')) throw new Error(`${label} must be a full SHA`);
}

function assertSafePath(value) {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').includes('..') ||
    /[\0-\x1f\x7f]/.test(value)
  ) {
    throw new Error(`unsafe changed path: ${JSON.stringify(value)}`);
  }
}

function changedFiles(root, baseSha, headSha) {
  const result = git(
    root,
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', `${baseSha}...${headSha}`],
    { encoding: 'buffer' },
  );
  const files = result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  if (files.length > maximumChangedFiles) {
    throw new Error(`changed file count exceeds ${maximumChangedFiles}`);
  }
  for (const file of files) assertSafePath(file);
  return files;
}

function blobAt(root, sha, file) {
  const result = git(root, ['show', `${sha}:${file}`], {
    encoding: 'buffer',
    maxBuffer: maximumReviewedBlobBytes + 1,
    allowFailure: true,
  });
  if (result.status !== 0) throw new Error(`cannot read reviewed blob: ${file}`);
  if (result.stdout.length > maximumReviewedBlobBytes) {
    throw new Error(`reviewed blob exceeds ${maximumReviewedBlobBytes} bytes: ${file}`);
  }
  return result.stdout;
}

function workflowFiles(root, sha) {
  const result = git(
    root,
    ['ls-tree', '-r', '--name-only', '-z', sha, '--', '.github/workflows'],
    { encoding: 'buffer' },
  );
  const files = result.stdout
    .toString('utf8')
    .split('\0')
    .filter((file) => /\.ya?ml$/.test(file));
  if (files.length > maximumChangedFiles) {
    throw new Error(`workflow file count exceeds ${maximumChangedFiles}`);
  }
  for (const file of files) assertSafePath(file);
  return files;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseWorkflow(root, headSha, file) {
  const document = parseDocument(blobAt(root, headSha, file).toString('utf8'), {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) throw new Error(`${file}: invalid workflow YAML: ${problem.message}`);
  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    throw new Error(`${file}: invalid workflow YAML: ${error.message}`);
  }
  if (!isRecord(workflow)) throw new Error(`${file}: workflow must be a mapping`);
  return workflow;
}

function assertDisplayName(name, location, matrixJob = false) {
  if (typeof name !== 'string' || !name || name !== name.trim()
    || /[\0-\x1f\x7f]/.test(name)) {
    throw new Error(`${location}: display name must be a non-empty one-line string`);
  }
  if (!/^[A-Z]/.test(name)) {
    throw new Error(`${location}: display name must be sentence case`);
  }
  const referencesMatrix = /\$\{\{\s*matrix(?:\.|\[)/.test(name);
  if (matrixJob && !referencesMatrix) {
    throw new Error(`${location}: matrix job display name must include its matrix values`);
  }
  if (!referencesMatrix) return;
  const suffix = name.match(/ \(([^()]*)\)$/);
  const item = /^(?:[A-Z][A-Za-z0-9 ._-]* )?\$\{\{ matrix\.[A-Za-z_][A-Za-z0-9_-]* \}\}$/;
  if (
    !suffix
    || name.slice(0, suffix.index).includes('${{')
    || !suffix[1].split(', ').every((value) => item.test(value))
  ) {
    throw new Error(
      `${location}: matrix display name must use one final parenthesized suffix`,
    );
  }
}

function assertActionReference(reference, file) {
  const externalAction =
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/;
  const dockerAction = /^docker:\/\/[^\s]+@sha256:[0-9a-f]{64}$/;
  if (typeof reference !== 'string' || reference !== reference.trim()) {
    throw new Error(`workflow action reference must be a string: ${file}`);
  }
  if (reference.startsWith('./')) return;
  if (!externalAction.test(reference) && !dockerAction.test(reference)) {
    throw new Error(`workflow action is not immutably pinned: ${file}: ${reference}`);
  }
}

function assertWorkflowPolicy(root, headSha, repository) {
  let foundSharedPolicyCallee = false;
  const files = workflowFiles(root, headSha);
  if (files.length === 0) throw new Error('repository must declare a workflow');
  for (const file of files) {
    const workflow = parseWorkflow(root, headSha, file);
    assertDisplayName(workflow.name, `${file}: workflow`);
    if (!isRecord(workflow.jobs) || Object.keys(workflow.jobs).length === 0) {
      throw new Error(`${file}: workflow must declare a non-empty jobs mapping`);
    }
    for (const [jobId, job] of Object.entries(workflow.jobs)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(jobId) || !isRecord(job)) {
        throw new Error(`${file}: invalid job ${jobId}`);
      }
      const matrixJob = isRecord(job.strategy)
        && Object.hasOwn(job.strategy, 'matrix');
      assertDisplayName(job.name, `${file}: job ${jobId}`, matrixJob);
      const references = [];
      if (Object.hasOwn(job, 'uses')) references.push(job.uses);
      if (Object.hasOwn(job, 'steps')) {
        if (!Array.isArray(job.steps)) throw new Error(`${file}: job ${jobId} steps must be a sequence`);
        for (const step of job.steps) {
          if (!isRecord(step)) throw new Error(`${file}: job ${jobId} step must be a mapping`);
          if (Object.hasOwn(step, 'uses')) references.push(step.uses);
        }
      }
      for (const reference of references) assertActionReference(reference, file);
      const sharedPolicyCall = typeof job.uses === 'string'
        && job.uses.startsWith(
          'phuongnse/renovate-ops/.github/workflows/policy-verification.yml@',
        );
      if (sharedPolicyCall && job.name !== sharedPolicyCallerName) {
        throw new Error(
          `${file}: shared policy caller must be named ${sharedPolicyCallerName}`,
        );
      }
      if (
        repository === 'phuongnse/renovate-ops'
        && file === '.github/workflows/policy-verification.yml'
        && jobId === 'policy-verification'
      ) {
        if (job.name !== sharedPolicyCalleeName) {
          throw new Error(`${file}: reusable job must be named ${sharedPolicyCalleeName}`);
        }
        foundSharedPolicyCallee = true;
      }
    }
  }
  if (repository === 'phuongnse/renovate-ops' && !foundSharedPolicyCallee) {
    throw new Error('operations repository must declare the shared policy callee');
  }
}

function assertRegularBlob(root, sha, file) {
  const result = git(root, ['ls-tree', sha, '--', file]);
  const mode = result.stdout.trim().split(/\s+/, 1)[0];
  if (!['100644', '100755'].includes(mode)) {
    throw new Error(`changed path is not a regular file: ${file}`);
  }
}

function assertNoCredential(blob, file) {
  if (blob.includes(0)) return;
  const text = blob.toString('utf8');
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bpypi-[A-Za-z0-9_-]{40,}\b/,
  ];
  if (patterns.some((pattern) => pattern.test(text))) {
    throw new Error(`credential-shaped content detected: ${file}`);
  }
}

async function readJsonIfPresent(root, candidates) {
  for (const candidate of candidates) {
    try {
      return {
        path: candidate,
        value: JSON.parse(await readFile(path.join(root, candidate), 'utf8')),
      };
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error(`${candidate} must use the strict JSON subset: ${error.message}`);
    }
  }
  return null;
}

async function assertRenovateContract(root) {
  const loaded = await readJsonIfPresent(root, [
    '.github/renovate.json',
    '.github/renovate.json5',
    'renovate.json',
    'renovate.json5',
  ]);
  if (!loaded) throw new Error('repository must declare a Renovate configuration');
  const config = loaded.value;
  if (config.draftPR !== true) throw new Error(`${loaded.path}: draftPR must be true`);
  if (config.branchPrefix !== 'automation/renovate/') {
    throw new Error(`${loaded.path}: unexpected branchPrefix`);
  }
  if (config.postUpgradeTasks !== undefined) {
    throw new Error(`${loaded.path}: postUpgradeTasks must be scoped to the engineering-process rule`);
  }
  const processRules = (config.packageRules ?? []).filter((rule) =>
    rule?.matchPackageNames?.includes('engineering-process')
  );
  let hasProcessPin = false;
  try {
    await readFile(path.join(root, 'requirements/process.in'), 'utf8');
    hasProcessPin = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if ((hasProcessPin || processRules.length > 0) && processRules.length !== 1) {
    throw new Error(`${loaded.path}: exactly one engineering-process rule is required`);
  }
  if (processRules.length === 1) {
    return classifyProcessAdoptionRule(
      processRules[0], `${loaded.path}: engineering-process rule`
    );
  }
  return 'absent';
}

async function assertProcessLock(root) {
  let input;
  try {
    input = await readFile(path.join(root, 'requirements/process.in'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const pins = [...input.matchAll(/^engineering-process==([0-9]+\.[0-9]+\.[0-9]+)$/gm)];
  if (pins.length !== 1) throw new Error('requirements/process.in must contain one exact authority pin');
  const lock = await readFile(path.join(root, 'requirements/process.txt'), 'utf8');
  if (!lock.includes(`engineering-process==${pins[0][1]}`) || !lock.includes('--hash=sha256:')) {
    throw new Error('requirements/process.txt must hash-lock the exact authority pin');
  }
}

function assertOperationsCommandAllowlist(config, adoptionState) {
  const declarations = [...config.matchAll(/\ballowedCommands\s*:/g)];
  if (declarations.length !== 1) {
    throw new Error('operations config must declare allowedCommands exactly once');
  }
  const value = config.slice(declarations[0].index + declarations[0][0].length);
  const parsed = value.match(
    /^\s*\[\s*(?:(?:'([^'\r\n]*)'|"([^"\r\n]*)")\s*,?)?\s*\]\s*,/,
  );
  if (!parsed) {
    throw new Error('operations command allowlist must be a canonical bounded array');
  }
  const rawCommand = parsed[1] ?? parsed[2] ?? null;
  const expectedRawCommand = ADOPTION_ALLOWED_COMMAND.replaceAll('\\', '\\\\');
  if (adoptionState === 'active' && rawCommand !== expectedRawCommand) {
    throw new Error(
      'active process adoption requires only the exact adoption runner in the operations allowlist',
    );
  }
  if (adoptionState !== 'active' && rawCommand !== null) {
    throw new Error(
      'inactive process adoption requires an empty operations command allowlist',
    );
  }
}

async function assertOperationsBoundary(root, repository, adoptionState) {
  if (repository !== 'phuongnse/renovate-ops') return;
  const config = await readFile(path.join(root, 'config.cjs'), 'utf8');
  const workflow = await readFile(path.join(root, '.github/workflows/renovate.yml'), 'utf8');
  for (const required of [
    'autodiscover: false',
    'allowScripts: false',
    'allowPlugins: false',
    'allowShellExecutorForPostUpgradeCommands: false',
  ]) {
    if (!config.includes(required)) throw new Error(`operations config missing ${required}`);
  }
  assertOperationsCommandAllowlist(config, adoptionState);
  if (/mount-docker-socket:\s*true/.test(workflow)) {
    throw new Error('Renovate workflow exposes the Docker socket');
  }
}

async function main() {
  const projectRoot = await realpath(argument('--project-root'));
  const outputPath = path.resolve(argument('--output'));
  const eventPath = path.resolve(argument('--event-path'));
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const repository = process.env.GITHUB_REPOSITORY;
  const pullRequest = event.pull_request;
  if (!pullRequest) throw new Error('policy verification requires a pull_request event');
  if (!/^phuongnse\/[a-z0-9._-]+$/.test(repository ?? '')) {
    throw new Error(`caller repository identity is invalid: ${repository}`);
  }
  if (repository !== event.repository?.full_name) {
    throw new Error(`policy event repository does not match the caller: ${repository}`);
  }
  if (pullRequest.base.ref !== 'main') throw new Error('pull request must target main');
  const baseSha = pullRequest.base.sha;
  const headSha = pullRequest.head.sha;
  assertSha(baseSha, 'base SHA');
  assertSha(headSha, 'head SHA');
  const checkoutSha = git(projectRoot, ['rev-parse', 'HEAD']).stdout.trim();
  if (checkoutSha !== headSha) throw new Error('checkout does not match the reviewed head SHA');

  git(projectRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
  git(projectRoot, ['diff', '--check', `${baseSha}...${headSha}`]);
  const files = changedFiles(projectRoot, baseSha, headSha);
  let aggregateBytes = 0;
  for (const file of files) {
    assertRegularBlob(projectRoot, headSha, file);
    const blob = blobAt(projectRoot, headSha, file);
    aggregateBytes += blob.length;
    assertNoCredential(blob, file);
  }
  if (aggregateBytes > maximumAggregateBytes) {
    throw new Error(`reviewed bytes exceed ${maximumAggregateBytes}`);
  }
  assertWorkflowPolicy(projectRoot, headSha, repository);
  const adoptionState = await assertRenovateContract(projectRoot);
  await assertProcessLock(projectRoot);
  await assertOperationsBoundary(projectRoot, repository, adoptionState);

  const report = {
    schemaVersion: 1,
    status: 'passed',
    governanceMode: 'single-maintainer',
    verificationKind: 'policy-verification',
    repository,
    baseSha,
    headSha,
    changedFileCount: files.length,
    reviewedBytes: aggregateBytes,
    verifierRepository: process.env.TRUSTED_WORKFLOW_REPOSITORY,
    verifierSha: process.env.TRUSTED_WORKFLOW_SHA,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`policy verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
