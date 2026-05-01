// Azure Static Web App for necogoode.com.
// Run from the deploy step in MORNING-CHECKLIST.md after `az login`.
//
//   az group create --name rg-necogoode-prod --location centralus
//   az deployment group create \
//     --resource-group rg-necogoode-prod \
//     --template-file infra/deploy.bicep \
//     --parameters repositoryUrl=https://github.com/BackpackNecoG/necogoode-website branch=main
//
// Note: `az staticwebapp create --source` is the alternative path — it provisions
// the same resource and ALSO wires the GitHub Actions workflow + secret. We prefer
// the CLI path for first-time setup; this Bicep is the IaC fallback / re-deploy artifact.

@description('Static Web App name. Globally unique within the resource provider.')
param staticWebAppName string = 'swa-necogoode-prod'

@description('Region. SWA is multi-region; we keep this in centralus to match other Neco Goode resources.')
param location string = 'centralus'

@description('GitHub repository URL — used to wire the SWA to its source.')
param repositoryUrl string = 'https://github.com/BackpackNecoG/necogoode-website'

@description('Branch to deploy from.')
param branch string = 'main'

@description('Alpha Vantage API key — passed in at deploy time, stored as an app setting.')
@secure()
param alphavantageKey string

resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    repositoryUrl: repositoryUrl
    branch: branch
    buildProperties: {
      appLocation: 'web'
      apiLocation: 'api'
      outputLocation: 'dist'
    }
  }
}

resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    ALPHAVANTAGE_KEY: alphavantageKey
  }
}

output defaultHostname string = swa.properties.defaultHostname
output staticWebAppId string = swa.id
