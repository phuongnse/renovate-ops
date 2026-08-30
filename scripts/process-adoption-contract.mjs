export const ADOPTION_COMMAND =
  'python .process/adopt-process.py --project-root . --requirements-lock requirements/process.txt';

export const ADOPTION_ALLOWED_COMMAND =
  String.raw`^python \.process/adopt-process\.py --project-root \. --requirements-lock requirements/process\.txt$`;

export const ADOPTION_FILE_FILTERS = Object.freeze([
  '.agents/skills/**',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.process/adopt-process.py',
  '.process/automation.json',
  '.process/adopt-process-windows-job.py',
  '.process/adoption-migrations/**',
  '.process/process.lock',
  '.process/project.json',
  'AGENTS.md',
]);

function sameArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function classifyProcessAdoptionRule(rule, label = 'engineering-process rule') {
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error(`${label} must be an object`);
  }
  if (rule.draftPR !== true) {
    throw new Error(`${label} must keep the adoption pull request in draft`);
  }
  if (rule.enabled === false) {
    if (Object.hasOwn(rule, 'postUpgradeTasks')) {
      throw new Error(`${label} legacy-disabled state must not run post-upgrade tasks`);
    }
    return 'legacy-disabled';
  }
  if (rule.enabled !== true) {
    throw new Error(`${label} enabled state must be explicit`);
  }
  if (!sameArray(rule.matchPackageNames, ['engineering-process'])) {
    throw new Error(`${label} must match only engineering-process`);
  }
  if (!sameArray(rule.matchFileNames, [
    'requirements/process.in',
    'requirements/process.txt',
  ])) {
    throw new Error(`${label} must match the input and compiled process locks`);
  }
  const tasks = rule.postUpgradeTasks;
  if (
    tasks === null
    || typeof tasks !== 'object'
    || Array.isArray(tasks)
    || JSON.stringify(Object.keys(tasks).sort())
      !== JSON.stringify(['commands', 'executionMode', 'fileFilters', 'installTools'])
    || !sameArray(tasks.commands, [ADOPTION_COMMAND])
    || !sameArray(tasks.fileFilters, ADOPTION_FILE_FILTERS)
    || tasks.executionMode !== 'update'
    || JSON.stringify(tasks.installTools) !== JSON.stringify({ python: {} })
  ) {
    throw new Error(`${label} has an invalid adoption task`);
  }
  return 'active';
}
