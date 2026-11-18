# PMOFlow R13 market re-review: consolidated (build cd1fa01)

Four reviewers, same personas and same fixed bar as R10–R12.

## 1. Outcomes

| Reviewer | Demo | Paid pilot | Contract | Year-1 size after pilot |
|---|---|---|---|---|
| Karen (ops director, search) | Yes | Likely ($2,500) | Not yet | $1,620–$2,340 |
| Jordan (PMO coordinator, search) | Yes | Likely ($2,500) | Not yet | $6,240 |
| PMO director (expert) | Yes | Yes ($2,500) | Not yet | **$23,400** (30 editors) |
| BPM/BA expert | Yes | Yes ($2,500) | Not yet | ~$6,240 |

- **Trend:** demo 4/4 and pilot 4/4 for the third round running. Contract 0/4.
- The PMO expert's deal size rose from about $19.5k to $23.4k.

## 2. What the bar still fails on

**Code** (all in R14 streams L1–L4):

1. **Integrity:**
   - History text was client-written; fixed in the R14 base.
   - No server check of task ownership.
   - A refused change appeared in History.
   - Refused attempts are not recorded.
2. **Governance bypasses:**
   - An owner can edit a due date past the deadline.
   - The PM can make himself sponsor.
   - The PM can rebaseline without approval.
   - An Admin moving someone's department grants rights on in-flight parts.
   - EV moves on unconfirmed Done.
3. **One number per fact:** test counts (38/42, 9/26 vs 9/32, "ALL COVERED"), blocker counts ("holds up 27" in 13 tasks), steps left vs checks, and finish-move days.
4. **Ownership:** unowned work was attributed to the PM; fixed in the R14 base, and two more fallbacks are going to L1.
5. **Cost:** expected cost shown from default rates.
6. **Reports:**
   - "Since last report" is not timestamp-exact.
   - Past ranges leak today's state.
   - Mixed time zones.
7. **Parser/import:**
   - branch targets;
   - "Role (Name)" in BPMN/VSDX;
   - a Visio decision dropped silently;
   - step numbers shift between preview and save;
   - per-vendor documents turned into project tasks.
8. **Launch override summary:** shows all green.
9. **Silent failures:** Advanced approval (fixed in the R14 base) and test self-assignment.

**Non-code** (founder):
- No SOC 2 or pen test. Both are on target dates (Q3 2027, Q1 2027).
- Solo vendor.
- SCIM is planned.
- The Team plan needs the customer's Azure deploy. This is Karen's top blocker and Jordan's IT concern. **Decision pending: hosted Team plan.**
- Search discoverability: zero (Jordan).

## 3. Positioning signal
The PMO director: "Already using Jira? Keep your workflow" wins budget in his org. That fits the founder positioning ("bring your existing tools or start fresh"). The R14 buyer site now leads the PMO path with it, with no banned words.

## 4. Grades that moved since R12
- **Karen:** C1 A-/A, C12 A-/B, C18 C (was D), C20 C+/B.
- **BPM expert:** C1 A-/A, C2 A-/A, C19 A/A.
- **PMO expert:** C12 dropped to C/A because the audit-integrity findings were discovered; C18 D/C.
- **Jordan:** C8 A/A, C14 A/B; C18 D.

## 5. R14 dispatch
CONTRACTS-R14.md, streams L1–L4.
- L4 (admin, sync, buyer site) has finished its first pass and is now on the two-person department-move item.
- L1–L3 are in progress.
