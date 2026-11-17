# PMOFlow relay (customer-deployed)

Already using Jira or Azure DevOps? Keep your workflow. PMOFlow syncs both ways. Connecting is optional: PMOFlow runs the whole project on its own, and this relay is only needed when you choose to connect a tool or send Teams / Outlook notifications.

The relay is a small Azure Function that runs **in your own Azure subscription**. It is the only part of PMOFlow that can reach Jira, Azure DevOps, Teams or Outlook.

PMOFlow never holds your Jira or Azure DevOps credentials, and never holds your Teams webhook addresses. They sit in **your** Key Vault, and only the relay's managed identity can read them.

## What it does

PMOFlow decides **what** should change and sends the relay a **sync intent**. An intent is a small JSON instruction, for example "set VOM-6 to Done". The relay:

1. **Checks the signature.** Each intent is HMAC-SHA256-signed with a per-project secret held in your Key Vault (`pmoflow-sync-<project>-v<n>`).
2. **Checks the time window.** An intent is valid for 5 minutes, with 30 seconds of clock skew allowed.
3. **Refuses replays.** Each intent has a nonce. The relay accepts a nonce once, and a shared Azure Table makes that hold across instances.
4. **Checks the target.** The intent must point at your Jira site or Azure DevOps organization and at a project you allowed (`ALLOWED_*` settings).
5. **Carries it out** with the credentials it reads from Key Vault, and returns a short result. Tokens, secrets and webhook addresses are never returned or logged.

| Operation | Jira Cloud (REST v3) | Azure DevOps (REST 7.1) |
|---|---|---|
| `create` | `POST /rest/api/3/issue`; assignee resolved with `GET /rest/api/3/user/search`; then a transition | `POST {org}/{project}/_apis/wit/workitems/${type}` (JSON Patch); then `System.State` |
| `update` | `PUT /rest/api/3/issue/{key}`; status via `GET`/`POST /rest/api/3/issue/{key}/transitions` | `PATCH {org}/_apis/wit/workitems/{id}` (JSON Patch) |
| `link` (dependencies) | `POST /rest/api/3/issueLink` with type `Blocks` (prerequisite = outward); `DELETE /rest/api/3/issueLink/{id}` | `System.LinkTypes.Dependency-Reverse` relations (`/relations/-`) |
| `pull` (changes since a cursor) | `POST /rest/api/3/search/jql` with `nextPageToken` paging | `POST {org}/{project}/_apis/wit/wiql?timePrecision=true`, then `POST …/_apis/wit/workitemsbatch` (200 ids per call) |
| `notify` | Teams: POST an Adaptive Card message to a Workflows webhook address | Outlook: Microsoft Graph `POST /users/{sender}/sendMail` |

**Sync rules.** These are applied by PMOFlow's sync engine, `lib/pmoflow-sync.js`, which is byte-identical to `api/shared/pmoflow-sync.js`:
- Title, description, status and assignee sync both ways. You can set the direction per field.
- Due dates and dependencies are owned by PMOFlow. If someone changes a due date in the tool, PMOFlow puts its own date back.
- The assignee is matched by email.
- If the same field changed on both sides, the later change wins. Each such conflict is logged.

## Deploy (about 15 minutes)

Prerequisites: Azure CLI with Bicep, and Azure Functions Core Tools v4.

```bash
# 1. Infrastructure: Function app (Flex Consumption, Node 22), Key Vault (RBAC), Storage (no shared keys), App Insights + Log Analytics
az group create -n rg-pmoflow-relay -l eastus2
az deployment group create -g rg-pmoflow-relay -f deploy/main.bicep \
  -p allowedJiraSite=yourcompany.atlassian.net allowedProjects=VOM \
     mailSender=pmoflow-notices@yourcompany.com allowedMailDomains=yourcompany.com
# outputs: functionAppName, relayUrl, healthUrl, keyVaultName, relayPrincipalId

# 2. Code (from this folder)
func azure functionapp publish <functionAppName>
```

**3. Secrets.** You need a Key Vault role that can set secrets, such as Key Vault Secrets Officer, on the vault.

```bash
KV=<keyVaultName>
# per-project signing secret (generate it in your tenant; PMOFlow's in-tenant API reads the same secret to sign)
az keyvault secret set --vault-name $KV --name pmoflow-sync-vendor-modernization-v1 --value "$(openssl rand -hex 32)"
# Jira: a dedicated service account and its API token
az keyvault secret set --vault-name $KV --name jira-user-email --value svc-pmoflow@yourcompany.com
az keyvault secret set --vault-name $KV --name jira-api-token  --value <api token>
# Teams: in the channel, Workflows → "Post to a channel when a webhook request is received" → copy the address
az keyvault secret set --vault-name $KV --name teams-webhook-project-updates --value "<workflow webhook address>"
```

The Teams secret name is `teams-webhook-` plus the channel name in lower case with dashes. PMOFlow shows the exact name on the Connections page. The relay refuses any intent that asks for a secret outside `teams-webhook-*`.

**4. Azure DevOps (managed identity, recommended).** No PAT is needed.
1. Go to Organization settings → Users, and add the relay's managed identity (`relayPrincipalId`) as a user.
2. Give it Contributor on the projects you allowed.

If you can't use the managed identity, deploy with `adoAuth=pat` and store a PAT as `ado-pat`. (Environment-Specific)

**5. Outlook (optional).**
1. Grant the relay's managed identity the Microsoft Graph application permission `Mail.Send`. Managed identities have no consent screen, so an admin assigns the app role with `az rest` (Environment-Specific, so verify the ids in your tenant first):

   ```bash
   GRAPH_SP=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query id -o tsv)
   az rest --method POST --uri https://graph.microsoft.com/v1.0/servicePrincipals/<relayPrincipalId>/appRoleAssignments \
     --body "{\"principalId\":\"<relayPrincipalId>\",\"resourceId\":\"$GRAPH_SP\",\"appRoleId\":\"b633e1c5-b582-4048-a93e-9f11b44c7e96\"}"
   ```

2. Limit that permission to the sender mailbox with Exchange Online RBAC for Applications, or an application access policy.

The relay also refuses recipients outside `ALLOWED_MAIL_DOMAINS`.

**6. Check it.** `GET <healthUrl>` lists which settings are present. It shows names only, never values.

**Turn it off.** Stop or delete the function app, or disable the PMOFlow enterprise app in Entra. Either one stops all sync.

## Settings

| Setting | Meaning |
|---|---|
| `KEY_VAULT_URI` | Your vault (set by the template). |
| `NONCE_TABLE_URL`, `NONCE_TABLE` | Shared replay store on Azure Table Storage (set by the template). Without it, a per-process memory store is used, which is fine for local runs only. |
| `ALLOWED_JIRA_SITE`, `ALLOWED_ADO_ORG`, `ALLOWED_PROJECTS`, `ALLOWED_PMOFLOW_PROJECTS` | The only targets the relay will touch. |
| `ADO_AUTH` | `managed-identity` (default) or `pat`. |
| `MAIL_SENDER`, `ALLOWED_MAIL_DOMAINS` | Outlook sender mailbox and allowed recipient domains. |
| `ALLOWED_ORIGIN` | Optional CORS origin, if a browser posts intents directly. |

## Intent format

```json
{ "v": 1, "id": "int-…", "kid": 1, "nonce": "…", "iat": "2026-11-17T15:00:00.000Z", "exp": "2026-11-17T15:05:00.000Z",
  "projectId": "vendor-modernization", "connectionId": "conn-vendor-modernization", "tool": "jira",
  "target": { "site": "yourcompany.atlassian.net", "projectKey": "VOM" },
  "op": "update", "ref": { "workItemId": "W6", "key": "VOM-6" },
  "payload": { "fields": { "summary": "…" }, "status": "Done" },
  "sig": "<hex HMAC-SHA256 over canonical JSON of everything except sig>" }
```

Canonical JSON means the keys are sorted at every level and there is no whitespace (`canonical()` in `lib/pmoflow-sync.js`). Send it as `POST /api/intent`. The relay answers `200` for success, `401` for a bad signature, expiry or unknown key, `409` for a replay, `403` for a target that isn't allowed, and `502` when the tool refuses.

**Key rotation.**
1. Add `pmoflow-sync-<project>-v2`.
2. Switch PMOFlow to key 2.
3. Delete v1 when no intents signed with it remain (at most 5 minutes later).

## Tests

`node tests/pmoflow/relay.test.js` runs from the repo root. All HTTP is mocked; no network is used. The tests cover:
- signature, expiry, clock skew, retired keys and replay, including the shared table store;
- Jira create, update, transition, link and paged pull;
- Azure DevOps JSON Patch create, update, relations, and WIQL plus batch pull;
- Teams and Graph payloads, allowlists, and secret-name confinement;
- error messages that never contain credentials.

## Known limits (honest list)

- **Not yet run against a live tenant.** The request shapes follow the documentation below and are verified with mocked HTTP only. (Unverified)
- **Jira email visibility.** Jira returns `emailAddress` only when the user's profile visibility allows it. When it is hidden, the relay doesn't report an assignee change, and the PMOFlow owner stays as it is.
- **Jira link direction.** For the `Blocks` link type, the prerequisite is sent as `outwardIssue`, matching the API's "from (outward) issue" wording. Check this once on your site. (Unverified)
- **Due date field.** Azure DevOps due-date fields differ by process template. The default is `Microsoft.VSTS.Scheduling.DueDate`. Change it on the Connections page under Advanced field mapping (for example, to `Microsoft.VSTS.Scheduling.TargetDate`). (Environment-Specific)
- **Jira statuses.** Statuses are matched by name through the workflow's available transitions. If no transition reaches the target status from the current one, the result is a warning and the change isn't applied.
- **Instance count.** The lowest `maximumInstanceCount` Flex Consumption accepts may change over time. Check the current documentation before lowering it. (Environment-Specific)

## Sources

- **Jira Cloud platform REST API v3:**
  - Issues: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
  - Issue search (`/rest/api/3/search/jql`): https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/
  - Issue links: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/
  - User search: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-user-search/
  - OpenAPI spec: https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json
  - The legacy `/rest/api/3/search` endpoint was removed: https://confluence.atlassian.com/jirakb/run-jql-search-query-using-jira-cloud-rest-api-1289424308.html
- **Azure DevOps:**
  - Work Items – Create: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/create
  - Work Items – Update: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/update
  - Get Work Items Batch: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch
  - WIQL – Query By Wiql: https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql
- **Teams:**
  - Incoming webhooks with Workflows (Office 365 connectors retired; Adaptive Card message format): https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
  - Workflows template: https://support.microsoft.com/en-us/office/send-messages-in-teams-using-incoming-webhooks-323660ec-12ca-40b1-a1d3-a3df47e808c4
- **Microsoft Graph:** user: sendMail (`Mail.Send`, 202 Accepted): https://learn.microsoft.com/en-us/graph/api/user-sendmail
- **Azure:**
  - Managed identity token endpoint (App Service / Functions): https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity
  - Key Vault Get Secret: https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/get-secret/get-secret
  - Flex Consumption Bicep: https://learn.microsoft.com/en-us/azure/azure-functions/functions-create-first-function-bicep
