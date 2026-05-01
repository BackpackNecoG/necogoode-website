# Morning Checklist — necogoode.com

> **Status as of 2026-05-01:** Code is complete, locally tested, and ready to deploy. **Azure deploy was deferred** because the cached `az login` token expired before kickoff. Steps below assume a fresh `az login`.

---

## 0. Re-authenticate to Azure (REQUIRED — token expired)

```bash
az login --tenant e342fcda-1af7-45d7-8552-9dc4f05346dd
az account set --subscription 3ce81091-d3b7-42bd-91dc-3e5fd2f1b127
az account show --query "{ name: name, id: id }" -o table
```

Expected output: `Azure subscription 1` / `3ce81091-d3b7-42bd-91dc-3e5fd2f1b127`.

---

## 1. Push the code to GitHub

The local repo has commits but has never been pushed. Verify and push:

```bash
cd C:\Claude\NecoGoodedotcom
git status                             # should be clean
git log --oneline | head -10           # should show ~8 logical commits

# Create the GitHub repo (public)
gh repo create BackpackNecoG/necogoode-website --public --source=. --remote=origin --description "Personal portfolio at necogoode.com"

# Push main
git push -u origin main
```

- [ ] Repo visible at https://github.com/BackpackNecoG/necogoode-website
- [ ] README renders the project overview

---

## 2. Create the Azure resource group + Static Web App

```bash
# 1) Resource group in Central US (matches SoloLift convention)
az group create --name rg-necogoode-prod --location centralus

# 2) Static Web App linked to the GitHub repo (this auto-installs the GitHub Actions workflow + secret)
az staticwebapp create \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --source https://github.com/BackpackNecoG/necogoode-website \
  --branch main \
  --app-location "/web" \
  --output-location "dist" \
  --api-location "/api" \
  --location centralus \
  --login-with-github
```

The `--login-with-github` flag opens a browser for the GitHub OAuth handshake — sign in if prompted.

- [ ] First deploy succeeds. Watch progress: https://github.com/BackpackNecoG/necogoode-website/actions
- [ ] Capture the assigned hostname:
      ```bash
      az staticwebapp show --name swa-necogoode-prod --resource-group rg-necogoode-prod --query defaultHostname -o tsv
      ```
- [ ] Live URL: `https://________________________.azurestaticapps.net`

---

## 3. Set the Alpha Vantage app setting (and delete the local key file)

```bash
# Read the key from the local file (never echo it)
$key = Get-Content C:\Claude\NecoGoodedotcom\AlphaVantage.txt -Raw
$key = $key.Trim()

# Set as app setting on the Static Web App
az staticwebapp appsettings set `
  --name swa-necogoode-prod `
  --resource-group rg-necogoode-prod `
  --setting-names "ALPHAVANTAGE_KEY=$key"

# VERIFY — the setting must be present (do NOT print value)
az staticwebapp appsettings list `
  --name swa-necogoode-prod `
  --resource-group rg-necogoode-prod `
  --query "properties | keys(@)" -o tsv
```

The output of the verify command must include `ALPHAVANTAGE_KEY`.

**Only after that confirmation:**

```powershell
Remove-Item C:\Claude\NecoGoodedotcom\AlphaVantage.txt
```

- [ ] App setting `ALPHAVANTAGE_KEY` confirmed present
- [ ] Local `AlphaVantage.txt` deleted
- [ ] Local `api/local.settings.json` (separate file) is .gitignored — no action needed

---

## 4. Verify the live site

Open `https://<your-swa-hostname>.azurestaticapps.net` and confirm:

- [ ] Splash door loads at `/`
- [ ] `/TechTour` loads (IDE layout, file tree, syntax-highlighted README)
- [ ] `/BusTour` loads (workshop with horizontal-scroll cards)
- [ ] `/floor` loads, counter widget shows `25 / 25 calls` (or whatever's left after testing)
- [ ] Type `AAPL` into the ticker prompt — see real quote, counter decrements
- [ ] Hover the counter — attribution tooltip appears
- [ ] Cross-tour links work between TechTour and BusTour creation pages
- [ ] 404 page exists for unknown routes (try `/foo`)

---

## 5. Add GoDaddy DNS records

Once the SWA is up, get the validation token + CNAME target:

```bash
az staticwebapp hostname add \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --hostname necogoode.com \
  --validation-method dns-txt-token

az staticwebapp hostname add \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --hostname www.necogoode.com \
  --validation-method cname-delegation
```

Each command prints a **TXT record** (apex) or **CNAME target** (www) that you must add at GoDaddy.

Then in **GoDaddy DNS Manager** for `necogoode.com`:

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | `@` | `<token-from-az-output>` | 1 hour |
| A | `@` | `<see Azure portal — apex requires A record to SWA's IP>` | 1 hour |
| CNAME | `www` | `<your-swa-hostname>.azurestaticapps.net.` | 1 hour |

Wait 5–15 minutes for DNS propagation:

```bash
nslookup necogoode.com 8.8.8.8
nslookup www.necogoode.com 8.8.8.8
```

- [ ] DNS records added at GoDaddy
- [ ] `nslookup` shows the SWA hostname (or its IP)

---

## 6. Bind the custom domain

**DO NOT run these until DNS resolves** (step 5 must show propagation):

```bash
az staticwebapp hostname add \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --hostname necogoode.com

az staticwebapp hostname add \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --hostname www.necogoode.com
```

Azure auto-provisions Let's Encrypt SSL once DNS validation succeeds — usually 5 minutes.

- [ ] `https://necogoode.com` loads with green lock
- [ ] `https://www.necogoode.com` loads
- [ ] (Optional) Set `necogoode.com` as the default hostname in the SWA's Custom domains pane in the Azure portal

---

## 7. Spending guardrail (recommended)

Set a $30/month budget alert on the resource group:

```bash
az consumption budget create \
  --resource-group rg-necogoode-prod \
  --budget-name necogoode-monthly \
  --amount 30 \
  --time-grain Monthly \
  --start-date 2026-05-01 \
  --end-date 2027-05-01 \
  --category Cost
```

If `az consumption budget create` is unavailable in your CLI version, do it manually in the Azure portal:
**Cost Management + Billing → Budgets → Add → scope to `rg-necogoode-prod` → $30/mo, alert at 80% and 100%**.

- [ ] Budget alert configured

---

## 8. Final pass

- [ ] `https://necogoode.com` loads, ticker works end-to-end on the live domain
- [ ] Type a real ticker on production, see counter decrement, then refresh — counter persists for the rest of the calendar day (UTC)
- [ ] Open `docs/VALIDATION.md` and read the honest self-assessment

---

**If anything goes wrong:** see `docs/HANDOFF.md` for V2 TODOs and known-gap workarounds, and `docs/ARCHITECTURE.md` for the data-flow map.
