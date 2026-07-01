# ProofLedger — Technical Specification

> Companion to `functional-spec.md`. v0 draft. 2026-07-01.
> Decisions locked: **local-first agent plugin** (no backend we operate), **founder's own provider keys**, **full-loop MVP** (ads + landing + Stripe + transcripts + decay).

---

## 1. Architecture at a glance

Local-first. The only thing we ship is a plugin + CLI that runs on the founder's machine. All real-world surface lives in the *founder's own* cloud accounts.

```
┌──────────────── founder's machine (their code repo) ────────────────┐
│                                                                      │
│  proofledger plugin/CLI  ──────────┐                                 │
│    ├─ skills (commands)            │                                 │
│    ├─ orchestrator                 │  reads/writes                   │
│    ├─ verifier modules   ──────────┼──►  .proofledger/  (file store) │
│    ├─ provider adapters            │        ledger.json              │
│    └─ PreToolUse build-gate hook ──┘        registrations/*.json     │
│              ▲                              evidence/*.json          │
│              │ blocks Write/Edit            experiments/*.json       │
│         [ code editor / agent ]                                      │
│                                                                      │
│  secrets → OS keychain (never in repo)                               │
└──────────────────────────────────────────────────────────────────────┘
        │ outbound API calls only (founder's keys)
        ▼
  Stripe API   Ad platform API   Static host API   Forms/Transcript API
 (pre-auth)    (Meta/Google)     (CF Pages/Vercel) (Tally / Whisper)
        ▲
        │ real strangers
   Landing page (hosted in FOUNDER'S host account, public URL)
```

**Invariant:** no ProofLedger-operated server exists. If we ever need to receive a webhook, we poll instead (see §6.3) to preserve the zero-infra property.

---

## 2. Components

### 2.1 Plugin + skills layer
- Packaged as a Claude Code plugin (also installable to Codex/Cursor via the `skills add` convention the topic repos use).
- Each `pl <command>` = one skill file with a deterministic tool-calling flow. LLM is used for *decomposition* and *explanation* only; all state transitions go through typed code, not model output.
- Thin CLI wrapper (`pl`) shells the same orchestrator so it works outside an agent too.

### 2.2 Orchestrator
- Pure TypeScript/Node core. Stateless between commands; all state in the file store.
- Owns the state machine: `hypothesis → registered → running → verifying → judged → (gate)`.

### 2.3 File store (`.proofledger/`)
- Human-readable JSON + a rendered `ledger.md` mirror (so it's diff-able in git and reviewable like telos' `brain/`).
- Committed to the founder's repo *except* secrets. `.proofledger/.gitignore` excludes nothing sensitive because secrets never land here.

### 2.4 Provider adapters
- One adapter per external system behind a common interface. Founder enables only the ones they use.
- `PaymentAdapter` (Stripe), `AdAdapter` (Meta, Google), `HostAdapter` (Cloudflare Pages, Vercel), `SurveyAdapter` (Tally/Typeform), `TranscriptAdapter` (local Whisper / provider API).

### 2.5 Verifier modules
- The integrity core. Given an experiment, each verifier **independently re-fetches** artifacts from the source of truth and returns typed evidence with a status. Verifiers never accept founder-supplied numbers.

### 2.6 Build-gate hook
- PreToolUse hook intercepting `Write`/`Edit`/`MultiEdit` whose path matches the configured `productGlobs`. Consults `ledger.json`; allows or blocks with a reason. (Same mechanism telos uses; our differentiator is *what* it checks — verified status, not a self-reported flag.)

---

## 3. Data model

### 3.1 Layout
```
.proofledger/
  config.json                 # product globs, budget caps, decay half-life, providers enabled
  ledger.json                 # canonical state (source of truth)
  ledger.md                   # rendered mirror (read-only)
  hypotheses/<id>.json
  registrations/<id>.json     # frozen thresholds + hash
  experiments/<id>.json       # run config + live counters + provider ids
  evidence/<id>.json          # verified artifacts
  audit.log                   # append-only: registrations, supersessions, gate decisions
```

### 3.2 Key schemas (abridged)

```jsonc
// hypotheses/<id>.json
{
  "id": "h_meal",
  "claim": "diabetics will pre-pay $15/mo for AI meal planning",
  "assumptions": [
    { "id": "a_want",   "text": "demand exists",            "critical": false, "status": "untested" },
    { "id": "a_pay",    "text": "will pre-pay $15/mo",      "critical": true,  "gate": true, "status": "untested" },
    { "id": "a_cac",    "text": "acquirable below price",   "critical": true,  "status": "untested" },
    { "id": "a_retain", "text": "retains > 3 months",       "critical": true,  "status": "untested" }
  ]
}
```

```jsonc
// registrations/<id>.json  — IMMUTABLE once created
{
  "id": "r_pay_1",
  "assumptionId": "a_pay",
  "metric": "preauth_conversion",        // preauths / clicks
  "sampleTarget": 300,
  "passIf":  { "op": ">=", "value": 0.05 },
  "killIf":  { "op": "<",  "value": 0.02 },
  "frozenAt": "2026-07-01T10:00:00Z",
  "hash": "sha256:…",                     // hash of the above; verified on every read
  "supersededBy": null
}
```

```jsonc
// evidence/<id>.json
{
  "id": "e_9f2",
  "experimentId": "x_demand_pay",
  "assumptionId": "a_pay",
  "type": "stripe_preauth",
  "status": "verified",                   // verified | provided | assumed | unknown
  "source": { "system": "stripe", "objectId": "pi_3Q…", "state": "requires_capture" },
  "fetchedAt": "2026-07-08T09:00:00Z",
  "expiresAt": "2026-10-06T09:00:00Z"     // fetchedAt + decayHalfLife
}
```

### 3.3 Status transition rule (the only way a node changes)
```
verifiedEvidence(assumption) → metricValue
compare(metricValue, registration.passIf/killIf):
   pass → alive
   kill → dead
   between → inconclusive (needs larger sample; node stays untested with a note)
any evidence past expiresAt → decayed
```
No code path lets an LLM or a founder set status directly. Enforced by keeping `status` writable only inside `applyVerification()`.

---

## 4. Verification design (the moat — detail per evidence type)

| Evidence type | Source of truth | How we verify (independent re-fetch) | Anti-cheat |
|---|---|---|---|
| **Pre-payment intent** | Stripe | `GET /v1/payment_intents?...` filter `status=requires_capture`, tagged with `metadata.pl_experiment=<id>` | Count only intents whose card passed auth; dedupe by fingerprint to stop one card × N; void after counting |
| **Ad clicks / spend** | Meta/Google Ads API | Pull insights report for the campaign id we created; read spend + link clicks | We created the campaign, so ids are ours; reject founder-typed numbers |
| **Email capture** | Host form / survey API | Fetch submissions for the deployed form id | Dedupe by email; drop obvious disposable domains |
| **Interview** | Calendar + transcript | Booked slot exists + transcript file with real timestamps + speaker turns | Reject transcripts without a matching calendar event |
| **Concierge / manual sale** | Stripe (captured) | Actual captured PaymentIntent | Highest-tier evidence; explicit opt-in |

**Verifier contract:** `verify(experiment) → Evidence[]`. Idempotent, read-only against the world, deterministic. If the source API is unreachable → evidence stays `unknown`, never optimistically `verified`.

---

## 5. Experiment runner (full loop)

`pl experiment run demand-pay` executes a saga; each step is resumable and idempotent (store provider ids so a re-run reconciles instead of duplicating).

```
1. renderLanding(hypothesis, price)      → static site bundle (headline, CTA, Stripe element)
2. HostAdapter.deploy(bundle)            → founder's CF Pages/Vercel → publicUrl
3. PaymentAdapter.setupPreauth(price, meta={pl_experiment})   → client secret wired into CTA
4. AdAdapter.createCampaign(publicUrl, budgetCap, targeting)  → campaignId (PAUSED)
5. confirm budget with founder → AdAdapter.activate(campaignId)
6. poll counters (clicks/emails/preauths) until sampleTarget or founder stops
7. AdAdapter.pause(campaignId)
```
Landing page bundle is a tiny static template (no server-side code) so it drops onto any static host. The Stripe element runs client-side with the founder's publishable key; the manual-capture intent is created via the founder's secret key from the CLI, not from the page.

**Budget safety:** hard cap in `config.json`; adapter refuses to activate a campaign whose daily budget × expected days exceeds the cap; every activation requires an explicit founder confirmation in the CLI.

---

## 6. Build-gate hook mechanics

### 6.1 Registration
`pl init` writes a PreToolUse hook entry into the agent's settings pointing at `proofledger gate-check`.

### 6.2 Decision flow
```
on Write/Edit(path):
  if not matches(path, config.productGlobs):  ALLOW
  gate = ledger.gatingAssumption
  switch gate.status:
    alive:               ALLOW
    dead|untested|decayed: BLOCK with reason + `pl status` hint
```
Block returns a non-zero decision with a human message (telos-style). Founder can override with `pl gate --override "<reason>"` which is **logged to audit.log** and stamped on the ledger export — so investors see any bypass. Ungameable-by-default, escapable-with-a-paper-trail.

### 6.3 Why polling, not webhooks
Stripe/ads would normally push webhooks, but a webhook needs a public receiver = a server we'd operate = breaks local-first. So `pl verify` **polls** the provider APIs on demand. Trade-off: counters aren't real-time push; the runner polls on an interval while running. Acceptable for a days-long experiment.

---

## 7. Assumption graph + decay

- Graph is implicit in `hypotheses/<id>.json` (nodes) + registrations (edges to evidence).
- `pl decay` (and every `pl status`) recomputes: `now > evidence.expiresAt` → node `decayed`. Half-life in `config.json`, default 90d.
- A decayed gating node **re-locks the build gate** — enforces that "we validated this last quarter" doesn't grant forever-access.

---

## 8. Secrets & keys

- Stored in OS keychain via `keytar` (macOS Keychain / libsecret / Windows Credential Vault). Never in `.proofledger/`, never in git.
- `pl connect` prefers OAuth where the provider supports it (Stripe Connect, Google Ads OAuth), falls back to API keys with least-privilege scopes documented.
- Adapters receive short-lived handles from a `SecretsProvider`; core logic never sees raw keys.

---

## 9. Tech choices (proposed)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript / Node 20+ | Matches Claude Code plugin ecosystem; single dep tree for CLI + hook |
| Distribution | npm package + `skills add` manifest | Same install path as topic repos (telos, hypothesis-validator) |
| Store | flat JSON + rendered md | Diff-able, reviewable, no DB to run (local-first) |
| Landing template | static (Astro/plain HTML) | Deploys to any static host, no server |
| Secrets | keytar | Cross-platform OS keychain |
| Payment | Stripe Node SDK, manual capture | Real intent-to-pay without charging |
| Ads | Meta Marketing API first, Google Ads second | Meta cheapest for consumer demand tests |
| Transcripts | local whisper.cpp default | Keeps data on founder's machine |

---

## 10. Security / legal / abuse

- **Real money:** default flow *voids* pre-auths; capturing requires explicit opt-in + clear disclosure copy on the landing page ("you are reserving a spot; card not charged"). Legal review before capture is enabled.
- **Ad platform ToS:** landing must describe a real forthcoming product; the runner refuses to deploy a page flagged as a pure fake-door without a disclosed waitlist. Document acceptable-use.
- **PII:** emails/transcripts live only on the founder's machine + their own providers; we store none. GDPR posture = we are not a processor (no infra).
- **Budget runaway:** hard caps + explicit activation confirmation (§5).
- **Gate bypass:** allowed but always audit-logged and surfaced in exports.

---

## 11. Resolved decisions (were open questions)

1. **Landing host default → Cloudflare Pages.** Generous free tier, single API-token auth, direct-upload deploy (no git required). `HostAdapter` interface stays provider-agnostic; Vercel is the second adapter.
2. **Statistical rigor → Wilson score interval, gate on the bound not the point estimate.** For a proportion metric, PASS requires the *lower* bound of the 95% Wilson interval ≥ `passIf`; KILL requires the *upper* bound < `killIf`; anything else = `inconclusive`. This is what stops "6/300 = 2%" being read as a clean result when the interval is wide. One formula, defensible, cheap.
3. **Inconclusive samples → one bounded auto-extension, then stop.** If still `inconclusive` at `sampleTarget`, the runner may extend the ad run once, up to `2× sampleTarget` (respecting budget cap), then reports the Wilson interval and leaves the node `untested` with a note. No open-ended spend.
4. **Verdict LLM → swappable, explanation-only, default latest Claude.** Provider set in `config.json`; runs on the founder's own key (local-first). Hard rule: the LLM receives already-computed statuses and only writes prose + "next cheapest test." It is never in the code path that sets a status. Enforced by API shape (`explain(ledger) → string`).
5. **Multi-agent editors → Claude Code first, hook layer abstracted.** `GateHook` interface with a Claude Code adapter in M1; Codex/Cursor adapters later. (Unchanged from before — still the plan, no longer open.)

### New decision — layered evidence ladder (from landscape research)
The gate does **not** jump straight to paid ads. Evidence has tiers of increasing cost + strength; the runner always proposes the cheapest untried tier first (mirrors "cheapest-to-kill" ordering).

| Tier | Test | Cost | Evidence strength | Verifier |
|---|---|---|---|---|
| **0** | Free public desk signal (impact-compass-style deterministic score over HN/Reddit/GitHub/Google Trends, log-scaled, red-ocean saturation penalty) | $0 | weak — screens out dead ideas, never grants a PASS on its own | `SignalAdapter` (unauth public APIs) |
| **1** | Fake-door landing + email capture | ~$0 | interest, not payment | `HostAdapter` + `SurveyAdapter` |
| **2** | **Stripe pre-auth** — real money committed | ad spend | strong — **this tier gates the build lock** | `PaymentAdapter` |
| **3** | Captured sale / concierge | real | strongest | `PaymentAdapter` (opt-in capture) |

Rules: Tier 0 can move a node to `dead` (cheap kill) but can **never** move it to `alive` — only Tier 2+ verified money does that for a gating assumption. This imports impact-compass's anti-brute-force scoring as a free pre-filter while keeping the real-money gate as the only thing that opens the coding lock.

---

## 12. MVP milestones (full-loop scope)

- **M1 — Ledger core + gate:** file store, hypothesis decompose, register (freeze+hash), status render, PreToolUse build-gate. *No real APIs yet — gate on manually-set-then-verified evidence.* Proves the integrity model.
- **M2 — Stripe verifier:** `PaymentAdapter` + pre-auth setup + `pl verify` re-fetch + void. First *real* evidence type. Gate now unlocks only on a verified pre-auth.
- **M3 — Landing + host:** template renderer + `HostAdapter` (Cloudflare Pages). Public URL wired to Stripe element.
- **M4 — Ad runner:** `AdAdapter` (Meta) + budget caps + counter polling. Full loop lands: idea → ad → strangers → pre-auth → verdict → gate.
- **M5 — Longitudinal:** decay recompute, re-lock on decay, `pl export` read-only investor view, transcripts.

Dogfood gate: run M1–M2 on ProofLedger itself before building M3+.
