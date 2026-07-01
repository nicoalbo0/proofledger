# ProofLedger — Data Model & State Machines

> Companion to `functional-spec.md` + `technical-spec.md`. v0 draft. 2026-07-01.
> Canonical store = flat JSON under `.proofledger/`. `ledger.md` is a rendered read-only mirror. TypeScript types are the contract; JSON on disk matches them 1:1.

---

## 1. File layout

```
.proofledger/
  config.json                 # settings (globs, caps, decay, providers, verdict LLM)
  ledger.json                 # index: which hypothesis is active, gating node, verdicts
  ledger.md                   # rendered mirror (never hand-edited)
  hypotheses/<hid>.json
  registrations/<rid>.json    # immutable once frozen
  experiments/<xid>.json
  evidence/<eid>.json
  audit.log                   # append-only JSONL
```

IDs: prefix + short nanoid — `h_`, `r_`, `x_`, `e_`. Human-readable, collision-safe, sortable enough.

---

## 2. Entities (TypeScript contract)

### 2.1 Config
```ts
interface Config {
  version: 1;
  productGlobs: string[];          // paths the build gate protects, e.g. ["src/**","app/**"]
  budget: {
    perExperimentUsdCap: number;   // hard cap; adapter refuses to exceed
    requireActivationConfirm: true;
  };
  decayHalfLifeDays: number;       // default 90
  providers: {
    payment?: "stripe";
    ads?: "meta" | "google";
    host?: "cloudflare_pages" | "vercel";
    survey?: "tally" | "typeform";
    transcript?: "whisper_local" | "provider";
    signal: "public";              // Tier-0, always available
  };
  verdictLlm: { provider: string; model: string }; // explanation-only
}
```

### 2.2 Hypothesis + Assumption
```ts
type AssumptionStatus = "untested" | "alive" | "dead" | "decayed" | "inconclusive";

interface Assumption {
  id: string;                 // a_pay
  text: string;
  critical: boolean;          // counts toward SHIP/KILL
  gate: boolean;              // is THIS the build-gating node? exactly one per hypothesis
  status: AssumptionStatus;   // written ONLY by applyVerification()
  minTier: 0 | 1 | 2 | 3;     // lowest evidence tier that can mark it `alive` (gate node ⇒ 2)
  activeRegistrationId?: string;
  note?: string;              // e.g. "inconclusive: Wilson [0.018, 0.081]"
}

interface Hypothesis {
  id: string;                 // h_meal
  claim: string;              // "[who] will [do what] because [why]"
  createdAt: string;          // ISO
  status: "active" | "archived";
  assumptions: Assumption[];
}
```

### 2.3 Registration (immutable)
```ts
interface Threshold { op: ">=" | ">" | "<" | "<="; value: number; }

interface Registration {
  id: string;                 // r_pay_1
  assumptionId: string;
  metric: "preauth_conversion" | "email_conversion" | "signal_score" | "interview_yes_rate";
  sampleTarget: number;
  passIf: Threshold;          // evaluated against Wilson LOWER bound for proportions
  killIf: Threshold;          // evaluated against Wilson UPPER bound
  confidence: number;         // default 0.95
  frozenAt: string;           // ISO
  hash: string;               // sha256 over {assumptionId,metric,sampleTarget,passIf,killIf,confidence,frozenAt}
  supersededBy: string | null;// new registration id if goalposts formally moved (audit-logged)
}
```
**Immutability rule:** any read verifies `hash`. A mismatch = tamper → the entity is quarantined and the gate hard-locks. Changing a bet means creating a *new* registration and setting `supersededBy` on the old — the old row is never edited.

### 2.4 Experiment
```ts
type ExperimentStatus =
  | "draft" | "deploying" | "running" | "paused" | "verifying" | "closed";

interface Experiment {
  id: string;                 // x_demand_pay
  assumptionId: string;
  registrationId: string;
  tier: 0 | 1 | 2 | 3;
  status: ExperimentStatus;
  providerRefs: {             // ids we created — the ONLY trustworthy handles
    landingUrl?: string;
    hostDeployId?: string;
    adCampaignId?: string;
    stripeMetadataTag?: string;   // metadata.pl_experiment=<xid>
    surveyFormId?: string;
  };
  counters: {                 // last polled snapshot, informational only
    clicks?: number; emails?: number; preauths?: number; spendUsd?: number;
    polledAt?: string;
  };
  startedAt?: string; closedAt?: string;
}
```

### 2.5 Evidence
```ts
type EvidenceStatus = "verified" | "provided" | "assumed" | "unknown";
// vocab aligned with validate-suite: measured→verified, cited→provided, user-stated→assumed, unknown→unknown

interface Evidence {
  id: string;                 // e_9f2
  experimentId: string;
  assumptionId: string;
  tier: 0 | 1 | 2 | 3;
  type: "stripe_preauth" | "ad_conversion" | "email_capture"
      | "interview" | "signal_desk" | "captured_sale";
  status: EvidenceStatus;
  value: number;              // the metric contribution (e.g. 1 per verified pre-auth)
  source: {                   // where it was re-fetched from
    system: "stripe" | "meta" | "google" | "host" | "survey" | "transcript" | "public";
    objectId?: string;        // pi_3Q…  / campaign id / submission id
    state?: string;           // requires_capture, etc.
    fingerprint?: string;     // for dedupe (card fingerprint, email hash)
  };
  fetchedAt: string;          // ISO
  expiresAt: string;          // fetchedAt + decayHalfLifeDays
}
```

### 2.6 Ledger index
```ts
interface Ledger {
  version: 1;
  activeHypothesisId: string | null;
  gate: {
    state: "open" | "locked";
    reason: string;
    gatingAssumptionId: string | null;
    lastEvaluatedAt: string;
    overrides: { at: string; reason: string; by: string }[]; // audit trail, surfaced in export
  };
  verdicts: Record<string /*hid*/, {
    verdict: "SHIP" | "SHARPEN" | "PIVOT" | "KILL" | "PENDING";
    computedAt: string;
    explanation: string;      // LLM prose, non-authoritative
  }>;
}
```

### 2.7 Audit log (append-only JSONL)
```ts
type AuditEvent =
  | { t: string; kind: "register";    registrationId: string; hash: string }
  | { t: string; kind: "supersede";   from: string; to: string; reason: string }
  | { t: string; kind: "verify";      experimentId: string; evidenceIds: string[] }
  | { t: string; kind: "status";      assumptionId: string; from: string; to: string; cause: string }
  | { t: string; kind: "gate";        decision: "allow" | "block"; path: string; reason: string }
  | { t: string; kind: "gate_override"; reason: string; by: string }
  | { t: string; kind: "ad_activate"; experimentId: string; budgetUsd: number };
```

---

## 3. State machines

### 3.1 Assumption status (the integrity core)
Transitions happen **only** inside `applyVerification(assumption)`. No other code path — and no LLM — may write `status`.

```
                 ┌─────────────┐
                 │  untested   │◄──────────────┐ (Wilson inconclusive at sampleTarget)
                 └─────┬───────┘               │
   verified evidence  │                        │
   (tier ≥ minTier)   │                        │
         ┌────────────┼────────────┐           │
         ▼            ▼            ▼            │
  Wilson lower   between      Wilson upper      │
   ≥ passIf     bounds      < killIf            │
         │            │            │            │
         ▼            ▼            ▼            │
     ┌───────┐  ┌───────────┐ ┌──────┐         │
     │ alive │  │inconclusive├─┤ dead │         │
     └───┬───┘  └─────┬─────┘ └──────┘         │
         │            └──────────────────────► (extend once, then untested)
         │  any evidence past expiresAt
         ▼
     ┌─────────┐
     │ decayed │ ── re-verify ──► back through applyVerification
     └─────────┘
```
- `alive` requires verified evidence at a tier `≥ minTier`. For the gating node `minTier = 2` ⇒ **only real money makes it alive**.
- Tier 0 can drive `dead` (cheap kill) but is `< minTier` for `alive` on any gating node — cannot open the gate.
- `decayed` on a gating node re-locks the build gate.

### 3.2 Experiment lifecycle
```
draft → deploying → running ⇄ paused → verifying → closed
                        │                    ▲
                        └─ counters poll ────┘
```
Each arrow is idempotent + resumable via `providerRefs` (re-run reconciles, never duplicates a campaign or intent).

### 3.3 Build gate (per Write/Edit)
```
Write(path)
  └─ path ∉ productGlobs ────────────────► ALLOW
  └─ path ∈ productGlobs
        gate.state == open (gating alive) ─► ALLOW
        else ─────────────────────────────► BLOCK (reason + `pl status`)
             └─ pl gate --override ────────► ALLOW + audit gate_override
```

### 3.4 Verdict rollup (mechanical)
```
g = gating assumption
alive(g)  & all critical alive        → SHIP
alive(g)  & some non-critical dead     → SHARPEN
dead(g)   & cheaper untried variant    → PIVOT
dead(g)   & no viable variant          → KILL
untested/inconclusive/decayed(g)       → PENDING (run/refresh)
```
LLM fills `explanation` only.

---

## 4. Invariants (must always hold; good test targets)

1. `status` and `gate.state` are written by exactly one function each; unit tests assert no other writer.
2. Every `Registration` read re-checks `hash`; mismatch ⇒ quarantine + hard-lock.
3. A gating assumption cannot be `alive` without ≥1 `Evidence` where `status==="verified"` and `tier>=2`.
4. No `Evidence.status` is `verified` unless it was re-fetched from `source.system` this run (never founder-supplied).
5. `providerRefs` ids are created by us; verifiers ignore any number not traceable to one.
6. Pre-auths are voided after counting unless Tier-3 capture is explicitly opted in.
7. Every gate block/override and every registration/supersession appends to `audit.log`.
