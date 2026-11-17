/* GET /api/health — what is configured (names only, never values). */
'use strict';
const { configFromEnv } = require('../lib/relay');

module.exports = async function (context) {
  const c = configFromEnv();
  const checks = {
    keyVault: !!c.keyVaultUri, managedIdentity: !!(c.identityEndpoint && c.identityHeader), sharedNonceStore: !!c.nonceTableUrl,
    jira: !!c.jiraSite, azureDevOps: !!c.adoOrg, projects: c.projects.length > 0, outlook: !!(c.mailSender && c.allowedMailDomains.length),
  };
  context.res = { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: { ok: checks.keyVault && checks.managedIdentity && checks.projects, version: 1, checks } };
};
