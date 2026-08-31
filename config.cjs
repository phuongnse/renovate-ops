'use strict';

const canonicalPipCompileCommand =
  'pip-compile --generate-hashes --no-emit-index-url --output-file=requirements/process.txt --strip-extras requirements/process.in';

const target = process.env.OPS_TARGET_REPOSITORY;
if (target !== undefined && !/^phuongnse\/[a-z0-9._-]+$/.test(target)) {
  throw new Error('OPS_TARGET_REPOSITORY must contain one exact trusted repository');
}

module.exports = {
  platform: 'github',
  endpoint: 'https://api.github.com/',
  ...(target === undefined ? {} : { repositories: [target] }),
  autodiscover: false,
  onboarding: false,
  requireConfig: 'required',
  forkProcessing: 'disabled',
  platformCommit: 'enabled',
  binarySource: 'install',
  constraints: {
    pipTools: '==7.6.1',
  },
  customEnvVariables: {
    CUSTOM_COMPILE_COMMAND: canonicalPipCompileCommand,
  },
  allowScripts: false,
  allowPlugins: false,
  allowShellExecutorForPostUpgradeCommands: false,
  allowedCommands: [
    '^python \\.process/adopt-process\\.py --project-root \\. --requirements-lock requirements/process\\.txt$',
  ],
  useCloudMetadataServices: false,
};
