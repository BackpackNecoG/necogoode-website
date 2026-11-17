/* The relay core: verify a signed intent, check it targets this customer's own site and projects, then run it.
   Everything it needs (tokens, secrets, HTTP, nonce store) is injected, so it runs unchanged in tests with mocked HTTP. */
'use strict';
const { verify } = require('./intent');
const { createHttp } = require('./http');
const { ManagedIdentityTokens, KeyVaultSecrets, SECRET_NAMES } = require('./azure');
const { MemoryNonceStore, TableNonceStore } = require('./intent');
const { JiraAdapter } = require('./jira');
const { AdoAdapter, ADO_RESOURCE } = require('./ado');
const notify = require('./notify');

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function configFromEnv(env) {
  env = env || process.env;
  return {
    keyVaultUri: env.KEY_VAULT_URI || '',
    jiraSite: String(env.ALLOWED_JIRA_SITE || '').toLowerCase(),
    adoOrg: String(env.ALLOWED_ADO_ORG || '').toLowerCase(),
    projects: list(env.ALLOWED_PROJECTS),                 /* Jira project keys / Azure DevOps project names this relay may touch */
    pmoflowProjects: list(env.ALLOWED_PMOFLOW_PROJECTS),  /* optional: PMOFlow project ids */
    adoAuth: env.ADO_AUTH === 'pat' ? 'pat' : 'managed-identity',
    mailSender: env.MAIL_SENDER || '',
    allowedMailDomains: list(env.ALLOWED_MAIL_DOMAINS).map(s => s.toLowerCase()),
    allowedOrigin: env.ALLOWED_ORIGIN || '',
    nonceTableUrl: env.NONCE_TABLE_URL || '',
    nonceTable: env.NONCE_TABLE || 'relaynonces',
    identityEndpoint: env.IDENTITY_ENDPOINT || '', identityHeader: env.IDENTITY_HEADER || '', identityClientId: env.AZURE_CLIENT_ID || '',
  };
}

function createRelay(opts) {
  const config = opts.config || configFromEnv();
  const http = opts.http || createHttp(opts.transport);
  const tokens = opts.tokens || new ManagedIdentityTokens({ http, endpoint: config.identityEndpoint, header: config.identityHeader, clientId: config.identityClientId });
  const secrets = opts.secrets || new KeyVaultSecrets({ http, tokens, vaultUri: config.keyVaultUri });
  const nonces = opts.nonces || (config.nonceTableUrl ? new TableNonceStore({ http, tokens, accountUrl: config.nonceTableUrl, table: config.nonceTable }) : new MemoryNonceStore());
  const getSecret = (projectId, kid) => secrets.get(SECRET_NAMES.signing(projectId, kid));

  async function jiraAuth() {
    const [email, token] = await Promise.all([secrets.get(SECRET_NAMES.jiraEmail), secrets.get(SECRET_NAMES.jiraToken)]);
    if (!email || !token) throw Object.assign(new Error(`Key Vault needs ${SECRET_NAMES.jiraEmail} and ${SECRET_NAMES.jiraToken}.`), { status: 503 });
    return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  }
  async function adoAuth() {
    if (config.adoAuth === 'pat') {
      const pat = await secrets.get(SECRET_NAMES.adoPat);
      if (!pat) throw Object.assign(new Error(`Key Vault needs ${SECRET_NAMES.adoPat}.`), { status: 503 });
      return 'Basic ' + Buffer.from(':' + pat).toString('base64');
    }
    return 'Bearer ' + await tokens.get(ADO_RESOURCE);
  }

  function targetError(intent) {
    const t = intent.target || {};
    if (intent.tool === 'jira') { if (!config.jiraSite || String(t.site).toLowerCase() !== config.jiraSite) return 'This relay is not set up for that Jira site.'; }
    else if (intent.tool === 'ado') { if (!config.adoOrg || String(t.site).toLowerCase() !== config.adoOrg) return 'This relay is not set up for that Azure DevOps organization.'; }
    else return 'Unknown tool.';
    if (!config.projects.includes(String(t.projectKey))) return 'This relay is not allowed to touch that project.';
    if (config.pmoflowProjects.length && !config.pmoflowProjects.includes(intent.projectId)) return 'This relay is not allowed to act for that PMOFlow project.';
    return null;
  }

  /* Returns {status, body}. Never includes secrets or tokens. */
  async function handle(intent) {
    try {
      const v = await verify(intent, { getSecret, nonces });
      if (!v.ok) return { status: v.status, body: { ok: false, refused: true, detail: 'Refused: ' + v.reason } };
      const bad = targetError(intent);
      if (bad) return { status: 403, body: { ok: false, refused: true, detail: 'Refused: ' + bad } };
      const conn = { tool: intent.tool, site: intent.target.site, projectKey: intent.target.projectKey, fields: {} };
      let result;
      if (intent.op === 'notify') {
        const p = intent.payload || {};
        result = p.channel === 'teams' ? await notify.teams({ http, secrets }, p)
          : p.channel === 'outlook' ? await notify.outlook({ http, tokens, config }, p) : { ok: false, detail: 'Unknown channel.' };
      } else {
        const adapter = intent.tool === 'jira' ? new JiraAdapter({ http, site: conn.site, auth: jiraAuth })
          : new AdoAdapter({ http, org: conn.site, project: conn.projectKey, auth: adoAuth });
        result = await adapter[intent.op](intent, conn);
      }
      return { status: result.ok ? 200 : 502, body: Object.assign({ intentId: intent.id }, result) };
    } catch (e) {
      return { status: e.status === 400 ? 400 : 503, body: { ok: false, detail: String(e.message || 'relay error').slice(0, 200) } };
    }
  }
  return { handle, config };
}

module.exports = { createRelay, configFromEnv };
