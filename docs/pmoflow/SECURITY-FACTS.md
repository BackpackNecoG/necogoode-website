# PMOFlow security facts (source for /pmoflow/security; distilled from the Project's security-architecture doc)

**Messaging rule:** say "your data and keys never leave your tenant." Never say "no code on our side." A hosted layer *is* code we serve.

## Built today (the live demo shows these)
- **Display-layer model.** PMOFlow is a hosted display layer. Customer process and project records live in the customer's own Azure tenant, behind an in-tenant API that runs on their subscription with their managed identity.
- **Project-scoped, time-boxed access to real data.** Access is granted for testing a project. The data owner approves it, it expires, and it closes automatically at launch. Shown in the demo.
- **Profiling returns statistics only, never raw values.** Sample checks keep no values.
- **Step-up check at the moment of sensitive actions.** Covers approvals, go-live and access grants. The demo accepts any 6 digits; in production this is Microsoft Entra Conditional Access authentication context.
- **Two-person rule.** The person who records tests can't also approve them, and go-live needs separate approvers.
- **Every change is recorded in history.** Audit export is in R10.
- **No third-party scripts in the app.** No analytics or tag managers.

## Production design (state it as "how it works in your tenant", not as already certified)
- **The browser never holds tokens for Graph, SharePoint or source systems.** The only scope it requests is the customer's own PMOFlow API. Per-site permissions use `Sites.Selected`, never tenant-wide.
- **Integration and pipeline credentials** (Jira, Azure DevOps, GitHub) sit in the customer's Key Vault and are read only by the customer's managed identity. PMOFlow never stores customer tokens.
- **Sync intents are signed and expire.** Each one is HMAC-signed with a per-project rotating secret, carries a nonce, expires after 5 minutes and is refused on replay.
- **Logs go to the customer's own Log Analytics / Sentinel.** Detection rules ship with the product.
- **Kill switch.** Disabling the PMOFlow enterprise app in Entra stops everything.
- **Conditional Access (compliant devices) and short sessions** (24h SPA refresh-token limit) are inherited from the customer's tenant.
- **Our side:**
  - MFA with hardware keys, protected branches, pinned dependencies, SBOM.
  - No standing access to customer Azure. Onboarding is the customer's admin running our template.

## Roadmap (must be labelled planned, never claimed as done)
- SOC 2 Type II or Microsoft 365 Certification (independent attestation): planned, not yet obtained.
- Annual third-party penetration test: planned.
- Customer-approved signed releases plus a verifying loader, and a public transparency log: planned for regulated buyers.
- SCIM provisioning: Enterprise plan, planned.

## Residual risks (state plainly)
- A customer admin could be socially engineered into approving a malicious release.
- Our own code bugs operate within the limits of the in-tenant API.
- No device-bound browser tokens yet (platform limitation).
- If our hosting is down, the display layer is down. Customer data is unaffected.
