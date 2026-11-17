// PMOFlow relay — deploys into the CUSTOMER's own subscription. Nothing here is shared with PMOFlow:
// the Key Vault, the function's managed identity, the logs and the nonce table all belong to the customer.
//
//   az group create -n rg-pmoflow-relay -l eastus2
//   az deployment group create -g rg-pmoflow-relay -f main.bicep \
//     -p allowedJiraSite=yourcompany.atlassian.net allowedProjects=VOM
//
// Then load the secrets into the Key Vault and publish the code (see ../README.md).
// Hosting: Azure Functions Flex Consumption (Linux), Node.js 22, system-assigned managed identity,
// identity-based storage (no storage keys), Key Vault with RBAC, workspace-based Application Insights.

@description('Azure region. Defaults to the resource group region.')
param location string = resourceGroup().location

@description('Short prefix for resource names (lowercase letters and numbers).')
@maxLength(10)
param prefix string = 'pmorelay'

@description('Your Jira Cloud site, e.g. yourcompany.atlassian.net. Leave empty if you only use Azure DevOps.')
param allowedJiraSite string = ''

@description('Your Azure DevOps organization name. Leave empty if you only use Jira.')
param allowedAdoOrg string = ''

@description('Comma-separated Jira project keys and/or Azure DevOps project names the relay may touch.')
param allowedProjects string

@description('Optional comma-separated PMOFlow project ids the relay may act for.')
param allowedPmoflowProjects string = ''

@description('How the relay signs in to Azure DevOps: its managed identity (recommended) or a PAT stored in Key Vault as ado-pat.')
@allowed([
  'managed-identity'
  'pat'
])
param adoAuth string = 'managed-identity'

@description('Mailbox Outlook notifications are sent from (needs the Graph Mail.Send application permission; see README). Empty disables email.')
param mailSender string = ''

@description('Comma-separated domains notifications may be emailed to, e.g. yourcompany.com.')
param allowedMailDomains string = ''

@description('Browser origin allowed to call the relay directly (CORS). Empty when only PMOFlow servers call it.')
param allowedOrigin string = ''

@description('Most instances the relay may scale out to.')
param maximumInstanceCount int = 40

@description('Memory per instance in MB.')
@allowed([
  512
  2048
  4096
])
param instanceMemoryMB int = 2048

var suffix = uniqueString(resourceGroup().id)
var storageName = take('${prefix}${suffix}', 24)
var vaultName = take('${prefix}-kv-${suffix}', 24)
var appName = '${prefix}-${suffix}'
var deployContainer = 'deployments'
var nonceTable = 'relaynonces'

// Built-in role definition ids
var roleBlobDataOwner = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleTableDataContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deployContainer
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource nonces 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: nonceTable
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${prefix}-plan-${suffix}'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'KEY_VAULT_URI', value: vault.properties.vaultUri }
        { name: 'NONCE_TABLE_URL', value: storage.properties.primaryEndpoints.table }
        { name: 'NONCE_TABLE', value: nonceTable }
        { name: 'ALLOWED_JIRA_SITE', value: allowedJiraSite }
        { name: 'ALLOWED_ADO_ORG', value: allowedAdoOrg }
        { name: 'ALLOWED_PROJECTS', value: allowedProjects }
        { name: 'ALLOWED_PMOFLOW_PROJECTS', value: allowedPmoflowProjects }
        { name: 'ADO_AUTH', value: adoAuth }
        { name: 'MAIL_SENDER', value: mailSender }
        { name: 'ALLOWED_MAIL_DOMAINS', value: allowedMailDomains }
        { name: 'ALLOWED_ORIGIN', value: allowedOrigin }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deployContainer}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
  dependsOn: [
    container
    nonces
  ]
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roleBlobDataOwner)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleBlobDataOwner)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, roleTableDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleTableDataContributor)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, app.id, roleKeyVaultSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = app.name
output relayUrl string = 'https://${app.properties.defaultHostName}/api/intent'
output healthUrl string = 'https://${app.properties.defaultHostName}/api/health'
output keyVaultName string = vault.name
output relayPrincipalId string = app.identity.principalId
