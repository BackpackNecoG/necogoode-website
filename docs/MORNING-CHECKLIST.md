# Morning Checklist — necogoode.com

> **Status:** Site is **LIVE** at https://red-grass-099f84510.7.azurestaticapps.net/
> Resource group `rg-necogoode-prod` is provisioned. SWA `swa-necogoode-prod` is deployed. `ALPHAVANTAGE_KEY` is in app settings. Local `AlphaVantage.txt` has been deleted.
> The only remaining work is **GoDaddy DNS records → custom domain bind → SSL verify** (sections 1–4 below).

---

## 1. Verify the live site

Open: https://red-grass-099f84510.7.azurestaticapps.net

- [ ] `/` — Splash door loads
- [ ] `/TechTour` — IDE layout, file tree, syntax-highlighted README
- [ ] `/BusTour` — Workshop with horizontal-scroll cards
- [ ] `/floor` — Counter widget shows X/25, ticker prompt accepts a symbol
- [ ] Type `AAPL` in the ticker — see real quote, counter decrements
- [ ] Hover the counter — attribution tooltip shows
- [ ] `/TechTour/creations/sololift` and similar slugs render the deep-dive
- [ ] Cross-tour links work between TechTour and BusTour creation pages
- [ ] Random URL like `/foo` shows the 404 page (custom NotFound)

If any of those fail, see `docs/VALIDATION.md` and `docs/HANDOFF.md`.

---

## 2. Add GoDaddy DNS records

In **GoDaddy DNS Manager** for `necogoode.com`, add these records:

| Type | Name | Value | TTL | Purpose |
|---|---|---|---|---|
| TXT | `@` | `_z0mpjhzvmo6yoarlmhtohgph6cjwb50` | 1 hour | Apex domain ownership validation |
| TXT | `www` | `_k1b4dzs0foiw88oclkal9cvfw61v9n3` | 1 hour | www subdomain ownership validation |
| CNAME | `www` | `red-grass-099f84510.7.azurestaticapps.net.` | 1 hour | Routes www → SWA |
| A | `@` | (see Azure portal — step 4) | 1 hour | Routes apex → SWA inbound IP |

**About the apex A record IP:** GoDaddy doesn't support ALIAS / ANAME / CNAME-flattening at the apex, so we need a real A record. The IP comes from Azure once apex validation completes (step 3 below). **Currently** `red-grass-099f84510.7.azurestaticapps.net` resolves to `132.220.38.112`, but Azure recommends using the IPs they show in the portal under Custom Domains because they can rotate.

**Alternative (simpler) for the apex:** use GoDaddy's **Domain Forwarding** to redirect `necogoode.com → https://www.necogoode.com` (permanent, with masking off). This sidesteps the apex-A-record-instability concern entirely. Most casual visitors will hit www anyway.

After adding records, verify propagation:
```bash
nslookup -type=TXT necogoode.com 8.8.8.8
nslookup -type=TXT www.necogoode.com 8.8.8.8
nslookup www.necogoode.com 8.8.8.8
```
The TXT lookups should show the tokens above. The www lookup should resolve to the SWA hostname / IP.

- [ ] TXT records added at GoDaddy
- [ ] CNAME for www added at GoDaddy
- [ ] DNS propagation verified (~5–15 min)

---

## 3. Wait for Azure to validate ownership

Azure auto-checks the TXT records every few minutes. Verify status:

```bash
az staticwebapp hostname list \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --query "[].{domain:domainName, status:status}" \
  -o table
```

Watch for `status` to change from `Validating` → `Ready` for both `necogoode.com` and `www.necogoode.com`. Usually within 5–15 min of DNS propagating.

- [ ] `necogoode.com` status is `Ready`
- [ ] `www.necogoode.com` status is `Ready`

---

## 4. Add the apex A record (only after step 3 says Ready)

Once apex validation is `Ready`, open the Azure portal:

```bash
# Open the Custom Domains pane in the SWA resource
az staticwebapp show \
  --name swa-necogoode-prod \
  --resource-group rg-necogoode-prod \
  --query "id" -o tsv
# Paste the returned ID into https://portal.azure.com/#@/resource{paste-ID}/customDomains
```

Or simpler: portal → Resource groups → `rg-necogoode-prod` → `swa-necogoode-prod` → **Custom domains**. Azure will display the **inbound IP** to use for the apex A record.

Add that IP at GoDaddy:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `<IP-from-Azure-portal>` | 1 hour |

(If you chose the GoDaddy forwarding alternative in step 2, skip this step entirely.)

- [ ] Apex A record added at GoDaddy (or forwarding configured instead)

---

## 5. Verify SSL + final smoke

Azure auto-provisions Let's Encrypt SSL once both DNS validation and routing are healthy. Wait ~5–10 min, then:

- [ ] `https://necogoode.com` loads with green lock
- [ ] `https://www.necogoode.com` loads with green lock
- [ ] Type a real ticker on prod, see the counter decrement, refresh the page — counter should persist for the rest of the UTC day (best-effort; see VALIDATION major #3 about scale-out drift)

---

## Reference — what's already done

| Resource | Name | Region | Notes |
|---|---|---|---|
| Resource group | `rg-necogoode-prod` | Central US | Tagged project=necogoode env=prod |
| Static Web App | `swa-necogoode-prod` | Central US | Free tier · `red-grass-099f84510.7.azurestaticapps.net` |
| App settings | `ALPHAVANTAGE_KEY` | (in SWA) | Verified present, key file deleted from disk |
| Custom domains | `necogoode.com` (apex), `www.necogoode.com` | (pending DNS) | TXT validation tokens issued |
| Budget alert | `necogoode-monthly` | rg-scoped | $30/mo · 80% + 100% emails to rennecog@gmail.com |
| GitHub repo | `BackpackNecoG/necogoode-website` | Public | CI/CD wired via `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret |

---

## If something is wrong

- **`/api/*` returns 500 in prod:** check `az staticwebapp appsettings list --name swa-necogoode-prod --resource-group rg-necogoode-prod` — `ALPHAVANTAGE_KEY` must be present.
- **DNS validation stuck on Validating after >30 min:** TXT token may have rotated. Re-fetch with `az staticwebapp hostname show --name swa-necogoode-prod --resource-group rg-necogoode-prod --hostname necogoode.com --query validationToken -o tsv`.
- **GH Actions deploy fails:** the most recent run logs are at https://github.com/BackpackNecoG/necogoode-website/actions. Past two flavors of failure:
  1. *"deployment_token provided was invalid"* — re-fetch SWA secret with `az staticwebapp secrets list --name swa-necogoode-prod --resource-group rg-necogoode-prod --query "properties.apiKey" -o tsv` and update the GH repo secret.
  2. *"Cannot deploy to the function app because Function language info isn't provided"* — already fixed in commit `f3fa2d0` (workflow now lets Oryx build the API).
