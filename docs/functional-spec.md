# ProofLedger — Functional Specification

> Working name: **ProofLedger**. CLI/plugin id: `proofledger` (alias `plg`).
> Status: v0 draft. Owner: Nicola. Date: 2026-07-01.

---

## 1. Thesis

Every tool in the startup-validation space grades an idea with an LLM's *guess* about the market. ProofLedger refuses guesses. It only counts evidence a machine can verify against the real world — real ad clicks, real interview transcripts, and above all **real money committed by real strangers** — and it will not let the founder write product code until at least one risky assumption has been killed or confirmed by that evidence.

**One sentence:** a living scoreboard of which of your beliefs survived contact with paying strangers, plus a coding lock that won't open until one did.

### What makes it different (vs. the topic landscape)
- **Adversarial critics** (hypothesis-validator, TO-BE-CEO): produce opinion. We produce measured outcomes.
- **Evidence gates** (telos, codex-build-gate): gate on *self-reported* evidence ("I talked to 5 people"). We gate on *machine-verified artifacts* (a real Stripe pre-auth object). Founder cannot type their way past the gate.
- **Synthetic demand** (swarmie, 500 AI users): simulated humans can't spend money. We use cheap *real* humans.
- **All of them:** one-shot snapshot. We track assumptions longitudinally; evidence decays and must be re-verified.

---

## 2. Personas

| Persona | Need | How they use it |
|---|---|---|
| **Solo technical founder** (primary) | Stop myself building the wrong thing | Runs plugin in their code repo; build-gate blocks premature coding |
| **Non-technical founder** | Cheap proof before hiring a dev | Runs experiment flows; exports the verdict scoreboard |
| **Accelerator / pre-seed investor** | Objective, un-gameable signal | Reads the verified ledger instead of a pitch deck |

Primary design target = the solo technical founder inside their coding environment (Claude Code / Codex / Cursor). That's where the build-gate has teeth.

---

## 3. Core concepts

- **Hypothesis** — a single falsifiable claim. Format: `[who] will [do what] because [why]`. Example: *"Type-2 diabetics will pre-pay $15/mo for AI meal planning because manual carb-counting is exhausting."*
- **Risky assumption** — an atomic belief the hypothesis depends on (demand exists / people will pay $X / acquirable below price / retention). Each is a node in the assumption graph.
- **Pre-registration** — before running any test, the founder freezes: the metric, the sample size, and the **PASS / KILL thresholds**. Once committed, thresholds are immutable (hash-locked). This is the clinical-trial trick that stops goalpost-moving — the thing critic-agents structurally cannot prevent.
- **Experiment** — a real-world test that emits evidence toward one assumption (ad-buy → landing → email/pre-auth; interview; concierge).
- **Evidence** — a *machine-verifiable artifact*: a Stripe PaymentIntent in `requires_capture`, an ad-platform conversion export, a signed form response, a timestamped transcript. Never free text.
- **Verification** — the plugin independently re-fetches the artifact from the source API and checks it. `Verified` ≠ `Provided`. (Ledger states borrowed from codex-build-gate: `Verified / Provided / Assumed / Unknown`.)
- **Assumption status** — `untested / alive / dead / decayed`. Driven only by verified evidence vs. frozen threshold.
- **Decay** — evidence has a half-life (default 90 days). Stale evidence flips the node to `decayed`; the belief must be re-proven.
- **Build gate** — a PreToolUse hook. Writes/Edits to `product/` are blocked while the *stage-gating* assumption is `dead`, `untested`, or `decayed`. Only verified evidence unlocks it.
- **Evidence ladder** — evidence comes in tiers of rising cost + strength: **Tier 0** free public desk signal (deterministic, impact-compass-style, log-scaled with a red-ocean saturation penalty), **Tier 1** fake-door landing + email, **Tier 2** Stripe pre-auth (real money — *this tier gates the build lock*), **Tier 3** captured sale. Cheapest untried tier runs first. Tier 0 can *kill* a belief for $0 but can never mark a gating assumption `alive` — only verified money does that.
- **Verdict** — per-hypothesis rollup: `SHIP / SHARPEN / PIVOT / KILL`, derived mechanically from node statuses, with an LLM layer only to *explain*, never to *decide*.

---

## 4. User journeys

### 4.1 Onboard
```
proofledger init
  → creates .proofledger/ in repo
  → asks: what are you trying to build? (captures "why")
  → connects provider keys (Stripe, one ad platform, one host) via `proofledger connect`
  → installs PreToolUse build-gate hook
```

### 4.2 Frame the bet
```
proofledger hypothesis "diabetics will pre-pay $15/mo for AI meal planning"
  → LLM decomposes into risky assumptions, ranks by "cheapest-to-kill first"
  → founder picks the assumption to test now
proofledger register
  → interactive: metric = pre-auth conversion
                 sample = 300 ad clicks
                 PASS if ≥ 5%   KILL if < 2%
  → thresholds frozen + hashed. Cannot edit later; only supersede with a new registration (audit-logged).
```

### 4.3 Run the real experiment (full loop)
```
proofledger experiment run demand-pay
  1. generates a landing page (headline from hypothesis, $15 "reserve your spot" CTA)
  2. deploys it to the FOUNDER'S host account (Cloudflare Pages / Vercel)   → public URL
  3. wires Stripe pre-auth (PaymentIntent capture_method=manual) to the CTA
  4. launches an ad set on the FOUNDER'S ad account, budget cap from `proofledger` config
  5. streams live counters: clicks / emails / pre-auths
```
No stranger ever touches our servers — page is on the founder's host, payments on the founder's Stripe, ads on the founder's ad account. The plugin is the orchestrator + verifier only.

### 4.4 Collect & verify
```
proofledger verify
  → re-fetches every artifact from source APIs:
     - Stripe: list PaymentIntents in requires_capture for this experiment
     - Ad platform: pull conversion + spend report
     - Forms/interviews: fetch responses + transcripts
  → marks each Verified / Provided / Assumed / Unknown
  → auto-refunds/voids the pre-auths after counting (never captures — this is a signal, not a sale, unless founder opts in)
```

### 4.5 Verdict + gate
```
proofledger status
```
Renders the scoreboard (see below). If the gating assumption is now `alive` → build-gate opens green. If `dead` → gate stays locked, and the ledger prescribes the next cheapest test.

### 4.6 The output the founder actually sees
```
┌─ PROOF LEDGER: meal-plan-diabetics ───────────────┐
│ VERDICT: PIVOT   (price assumption dead)           │
│ Registered bet: pre-pay ≥ 5%   Actual: 2.0% (6/300)│
│ Real $ committed: $90    CAC→pre-pay: $25 (>$15) ✗ │
│                                                    │
│ ASSUMPTIONS                                        │
│  ● want it .......... ALIVE   41 emails  [verified]│
│  ● pay $15 .......... DEAD    2% < 5%     [verified]│
│  ● acquire < price .. DEAD    $25 > $15   [verified]│
│  ● retain ........... UNTESTED                      │
│                                                    │
│ EVIDENCE (machine-verified)                        │
│  - Stripe: 6× PaymentIntent requires_capture [ids] │
│  - Meta Ads: conversion export [link]              │
│  - 3 transcripts [links]                           │
│                                                    │
│ BUILD GATE: 🔒 LOCKED — pay-assumption dead        │
│ NEXT CHEAPEST TEST: price at $8 (re-register)      │
└────────────────────────────────────────────────────┘
```

---

## 5. Commands (skills)

| Command | Does |
|---|---|
| `proofledger init` | Scaffold `.proofledger/`, capture motivation, install hook |
| `proofledger connect <provider>` | OAuth/key setup for Stripe / ad platform / host, stored in OS keychain |
| `proofledger hypothesis "<claim>"` | Decompose into ranked risky assumptions |
| `proofledger register` | Freeze metric + sample + PASS/KILL thresholds (hash-locked) |
| `proofledger experiment run <name>` | Deploy landing, wire Stripe, launch ads, stream counters |
| `proofledger verify` | Re-fetch + verify all artifacts, update node status, void pre-auths |
| `proofledger status` | Render scoreboard + verdict + gate state |
| `proofledger gate` | Explain why the build gate is open/closed right now |
| `proofledger decay` | Recompute node freshness, flip stale nodes to `decayed` |
| `proofledger pivot` | Archive dead hypothesis, seed a new registration |
| `proofledger export` | Emit shareable read-only ledger (for investors/accelerators) |

Mirrors the successful skill-trigger UX of startup-skill/telos, but each command touches real APIs.

---

## 6. Verdict logic (mechanical, not LLM)

```
gating_assumption = the node marked stage-gate (usually "pay")

if gating.alive and all critical.alive         → SHIP
if gating.alive and some non-critical dead     → SHARPEN
if gating.dead and a cheaper variant untested  → PIVOT
if gating.dead and no viable variant left      → KILL
if gating.untested/decayed                     → (no verdict) run/refresh test
```
LLM writes the human-readable *reason* and the *next cheapest test*. LLM never sets a status — status comes only from verified-evidence-vs-frozen-threshold comparison. This is the core integrity guarantee.

---

## 7. Non-goals (v1)

- Not a pitch-deck / financial-model generator (startup-skill already does that well — integrate later, don't rebuild).
- Not a synthetic-user simulator.
- Not a hosted SaaS — we run zero servers.
- Not a real revenue product — pre-auths are voided by default; capturing money is an explicit opt-in.
- No autonomous ad spend without a founder-set hard budget cap + confirmation.

---

## 8. Success criteria for the product itself (dogfood)

We validate ProofLedger with ProofLedger: register "technical founders will pre-pay for a validation tool that gates their coding," run the loop on ourselves before writing the product beyond MVP.
