'use strict';

const repositories = process.env.RENOVATE_REPOSITORIES
  ? process.env.RENOVATE_REPOSITORIES.split(',')
  : require('./repositories.json');

module.exports = {
  platform: 'github',
  endpoint: 'https://api.github.com/',
  repositories,
  autodiscover: false,
  onboarding: false,
  requireConfig: 'required',
  forkProcessing: 'disabled',
  platformCommit: 'enabled',
  binarySource: 'install',
  allowScripts: false,
  allowPlugins: false,
  allowShellExecutorForPostUpgradeCommands: false,
  allowedCommands: [],
  useCloudMetadataServices: false,
};
