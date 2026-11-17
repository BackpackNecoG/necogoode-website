/* Managed identity tokens and Key Vault secrets, on the relay's own identity. No credentials in code or settings.
   Tokens: App Service / Functions managed identity endpoint (IDENTITY_ENDPOINT + IDENTITY_HEADER, api-version 2019-08-01).
   Secrets: Key Vault REST GET {vault}/secrets/{name}?api-version=7.4 with a token for https://vault.azure.net. */
'use strict';
const { failure } = require('./http');

class ManagedIdentityTokens {
  constructor({ http, endpoint, header, clientId }) { Object.assign(this, { http, endpoint, header, clientId }); this.cache = new Map(); }
  async get(resource) {
    const hit = this.cache.get(resource);
    if (hit && hit.until > Date.now() + 120000) return hit.token;
    if (!this.endpoint || !this.header) throw Object.assign(new Error('managed identity is not available (IDENTITY_ENDPOINT / IDENTITY_HEADER unset)'), { status: 503 });
    const q = new URLSearchParams({ resource, 'api-version': '2019-08-01' });
    if (this.clientId) q.set('client_id', this.clientId);
    const r = await this.http.request({ method: 'GET', url: `${this.endpoint}?${q}`, headers: { 'X-IDENTITY-HEADER': this.header } });
    if (r.status !== 200 || !r.body || !r.body.access_token) throw Object.assign(new Error(failure('Managed identity', r)), { status: 503 });
    const until = Number(r.body.expires_on) * 1000 || Date.now() + 10 * 60000;
    this.cache.set(resource, { token: r.body.access_token, until });
    return r.body.access_token;
  }
}

const NAME_RE = /^[0-9a-zA-Z-]{1,127}$/;
class KeyVaultSecrets {
  constructor({ http, tokens, vaultUri, ttlMs }) { Object.assign(this, { http, tokens, vaultUri: String(vaultUri || '').replace(/\/+$/, ''), ttlMs: ttlMs || 5 * 60000 }); this.cache = new Map(); }
  /* Returns the secret value, or null when it doesn't exist (404). */
  async get(name) {
    if (!NAME_RE.test(name)) throw Object.assign(new Error('invalid secret name'), { status: 400 });
    const hit = this.cache.get(name);
    if (hit && hit.until > Date.now()) return hit.value;
    if (!this.vaultUri) throw Object.assign(new Error('KEY_VAULT_URI is not set'), { status: 503 });
    const token = await this.tokens.get('https://vault.azure.net');
    const r = await this.http.request({ method: 'GET', url: `${this.vaultUri}/secrets/${name}?api-version=7.4`, headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 404) { this.cache.set(name, { value: null, until: Date.now() + 30000 }); return null; }
    if (r.status !== 200 || !r.body || typeof r.body.value !== 'string') throw Object.assign(new Error(failure('Key Vault', r)), { status: 503 });
    this.cache.set(name, { value: r.body.value, until: Date.now() + this.ttlMs });
    return r.body.value;
  }
}

/* Secret names the relay reads. The signing secret is per PMOFlow project and per key version (rotation adds v2, v3, ...). */
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const SECRET_NAMES = {
  signing: (projectId, kid) => `pmoflow-sync-${slug(projectId)}-v${kid}`,
  jiraEmail: 'jira-user-email',
  jiraToken: 'jira-api-token',
  adoPat: 'ado-pat',
};

module.exports = { ManagedIdentityTokens, KeyVaultSecrets, SECRET_NAMES, slug };
