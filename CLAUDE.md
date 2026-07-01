# ProofLedger — CLAUDE.md

Local-first startup-validation plugin. Refuses to let a founder write product code until a risky assumption is confirmed/killed by **machine-verified real-world evidence** — real ad clicks, transcripts, and above all real money committed by strangers (Stripe pre-auth).

> **STANDING RULE:** update this file's *Build progress* section every coding session before finishing. It is the context anchor for future sessions; a stale one misleads. Treat updating it as part of "done."

## Read first
Specs are the source of truth — read before coding:
- `docs/functional-spec.md` — thesis, personas, concepts, journeys, commands, evidence ladder
- `docs/technical-spec.md` — architecture, adapters, verification, gate, resolved decisions, milestones
- `docs/data-model.md` — TS schemas + state machines + invariants (the integrity contract)
- `docs/m1-tasks.md` — current milestone breakdown (epics A–F)

## Non-negotiable invariants (data-model §4)
1. `Assumption.status` written by **exactly one** function (`applyVerification`); `gate.state` by exactly one (gate module). Nothing else, no LLM.
2. Registrations are **hash-locked**; tamper → quarantine + hard-lock.
3. A gating assumption goes `alive` **only** on verified evidence at tier ≥ 2 (real money).
4. Evidence is `verified` only if re-fetched from its source this run — never founder-supplied.
5. Pre-auths voided after counting unless Tier-3 capture is opted in.
6. Zero infra: no server we operate. Landing/pay/ads run in the founder's own accounts.

## Architecture (one line)
TS/Node npm package → CLI `pl` + Claude Code plugin. Flat-JSON store in `.proofledger/`. Provider adapters call the founder's Stripe/ads/host. Verifier re-fetches artifacts. PreToolUse hook = build gate.

## Stack
Node 20+, TypeScript strict, Vitest, flat-JSON store, keytar for secrets. No DB, no server.

## Commands (dev)
- `npm run build` — tsc
- `npm test` — vitest
- `npm run cli -- <cmd>` — run the CLI locally (installed bins: `proofledger`, `plg`)

## Build progress
_Milestone: **core promise LIVE-VALIDATED.** 67 unit tests + 2 live, typecheck clean, 0 vulns._

**Live validation (real infra):**
- ✅ **Build gate blocks Claude Code in a live session** — a Write to `src/app.ts` under a locked gate was DENIED with the ProofLedger reason. The headline feature works in-vivo.
- ✅ Stripe test-mode (dedupe + void), ✅ Cloudflare Worker (deploy+serve).
- ⚠ Found + fixed via live test: PreToolUse passes an **absolute** file_path; productGlobs are repo-relative → gate allowed everything. Fixed in `gate-hook.ts` (relativize vs payload cwd) + regression test. Would have broken the gate for every user.
- Bin renamed `pl`→`proofledger` (+`plg`) — `pl` collided with `/usr/bin/pl`.
- Remaining live gap: Meta ads (unit-tested; user has no FB app) + the combined `experiment run` seam. Non-critical (traffic source).

**npm verdict:** core is proven; publishing 0.1.0 is defensible (label Meta "unit-tested, live run pending").

**npm-hardening:**

**npm-hardening (latest):**
- `src/hook/gate-hook.ts` + tests — PreToolUse gate mechanics proven offline (block locked, allow open, allow non-product, fail-open); `hooks/build-gate.mjs` now a thin wrapper.
- `pl doctor [--ping]` (`src/commands/doctor.ts`) + `src/adapters/verify-credentials.ts` — provider connection status + cheap live ping (Stripe/CF/Meta), mock-fetch tested.
- CLI hardening: `num()` validates numeric flags (reject NaN/negative), `pl --version`.
- `CHANGELOG.md`; package `files` verified via `npm pack --dry-run` (no src/tests/secrets ship).

**Blocking npm publish — needs USER's live env (not code):**
1. One real `pl experiment run` end-to-end incl. Meta (even sandbox).
2. Install plugin in a real Claude Code session; confirm the PreToolUse gate actually blocks a Write. Validate plugin.json against current Claude Code plugin schema.

**_Uncommitted on `main`:_** pivot/export/poll + doctor/hook/version/validation/CHANGELOG + README fix (needs a branch to commit).

**CLI completeness:**
- `pl pivot ["<claim>"]` — archive active hypothesis (+ optional new), gate re-locks.
- `pl export` — shareable read-only report; verified-evidence counts + **surfaces gate overrides**. Pure `buildExport`.
- `pl experiment poll --experiment <id>` — real clicks/spend via Meta insights.
- README status corrected. Command set matches functional-spec §5. Tests: `src/commands/pivot-export.test.ts`.
- _Uncommitted:_ pivot/export/poll + README live in the working tree on `main` (needs a branch to commit).

**Live smoke results:** Stripe test-mode PASS (dedupe 3→2 + voids), Cloudflare Worker PASS (deploy+serve). Meta unit-tested only.

**Network wiring:**
- `src/adapters/http.ts` — `httpJson` wrapper with **injectable `fetch`** (adapters unit-tested offline with mock fetch).
- `src/adapters/host.ts` — `CloudflareWorkerAdapter` (real): deploys landing as a Worker (PUT script → enable subdomain → resolve workers.dev URL). Pure `buildWorkerScript` + `workerName`. Replaced the Pages skeleton (Worker path avoids Pages' hash-manifest/upload-token).
- `src/adapters/ad.ts` — `MetaAdAdapter` (real): Graph v21 full flow campaign→adset→**adcreative→ad**, all PAUSED; activate/pause/insights. Needs a Facebook Page id (`meta.page` secret). Pure `campaignPayload`/`adSetPayload`/`adCreativePayload`/`adPayload`/`sumInsights`.
- `src/adapters/signal.ts` — `PublicSignalAdapter`: injectable fetch, real relevance ratio (phrase vs broad HN hits), degrade-to-0.
- keytar: `KeychainSecrets` already functional (lazy import → `FileSecrets` fallback). No longer a skeleton.
- Tests `src/adapters/network.test.ts` (10): worker script/name, CF deploy call sequence + URL, Meta payloads/insights/createCampaign, signal counts+relevance+degrade.

**Live smoke tests (env-gated, skipped in CI):** `src/adapters/stripe.live.test.ts` (`npm run smoke:stripe`, needs `PL_LIVE_STRIPE=sk_test_...`), `src/adapters/cloudflare.live.test.ts` (`npm run smoke:cf`, needs `PL_LIVE_CF_ACCOUNT`/`PL_LIVE_CF_TOKEN`). Meta = manual, see `docs/smoke-test.md`. Run order: Stripe test-mode → Cloudflare free → Meta sandbox.

**Still needed for a real paid loop:** run the 3 smoke tests with real keys; keyword→interest targeting refinement on Meta; wire `pl verify` tier dispatch polish.

---
### Earlier: M4 + launch scaffold

**M4 + launch (this session):**
- `src/adapters/ad.ts` — `AdAdapter` + `FakeAdAdapter` + `MetaAdAdapter` skeleton + `projectedSpendUsd`.
- `src/commands/experiment.ts` — `runExperiment` saga (idempotent via providerRefs; budget-cap guard; ads created PAUSED; activation opt-in + audited) + `pollExperiment`.
- CLI: `experiment run`, `verify --experiment <id>` (real Stripe path via secrets), `need()` secret helper.
- Tests `src/m4.test.ts`: deploy+paused campaign, idempotent re-run, budget cap rejects, activation audited, **FULL LOOP run→poll→verify→gate opens**.
- Quality: no console/as-any/ts-ignore in domain; **0 npm vulns** (bumped vitest→4); `.gitignore` fixed (docs tracked, secrets guarded); package.json launch metadata + `files` allowlist + optionalDependencies (stripe, keytar).
- `.github/`: dependabot, CI (Node 20/22), CodeQL, release (npm provenance), issue/PR templates, SECURITY, CODEOWNERS. Root: README, LICENSE (Apache-2.0) + NOTICE, CONTRIBUTING, CODE_OF_CONDUCT.

---
### Earlier: M3 (signal, landing, secrets)

**M3 done (offline-testable; real network/host calls are marked skeletons):**
- `src/domain/signal.ts` — Tier-0 deterministic scorer (impact-compass-style): `logScore` + weighted pillars + **red-ocean penalty** + relevance penalty. Pure.
- `src/adapters/signal.ts` — `SignalAdapter` interface + `FakeSignalAdapter` + `PublicSignalAdapter` (HN Algolia / GitHub search, degrade-to-0 on failure).
- `src/commands/signal.ts` + `pl signal` — writes tier-0 `signal_desk` evidence. Weak score → assumption `dead` ($0 kill); strong score → `inconclusive` (tier 0 < minTier, never opens gate). Proven by tests.
- `src/domain/landing.ts` — pure `renderLanding` static HTML (headline/price/CTA/email + Stripe element + **"card NOT charged" disclosure**). Escapes HTML.
- `src/adapters/host.ts` — `HostAdapter` + `FakeHostAdapter` + `CloudflarePagesAdapter` skeleton.
- `src/secrets/secrets.ts` — `SecretsProvider`: `KeychainSecrets` (lazy keytar) → `FileSecrets` fallback (0600 file + PL_ env). `pl connect <provider> --key val` stores them. Secrets never touch the repo.
- CLI is now async; added `connect` + `signal`.

---
### Earlier: M2 (payment-verification core)

**M2 done (real Stripe pre-auth verification, offline-testable):**
- `src/adapters/payment.ts` — `PaymentAdapter` interface (setupPreauth/listPreauths/voidPreauth) + `RawPreauth`.
- `src/adapters/fake-payment.ts` — in-memory adapter for tests.
- `src/adapters/stripe.ts` — `StripePaymentAdapter` (lazy `import("stripe")`, manual-capture intents) + pure `mapIntentToRawPreauth`. `stripe` stays an optional dep, loaded only on connect.
- `src/domain/verify-core.ts` — `filterCountablePreauths`: anti-cheat core (requires_capture + our tag + dedupe by card fingerprint + reject null-fp). Pure, tested.
- `src/commands/verify-payment.ts` — `runPaymentVerification`: re-fetch → filter → verified Evidence → **void holds** (signal not sale) → applyVerification → recompute.
- `src/commands/decay.ts` + `pl decay` — re-evaluate all assumptions; gate re-locks on decay.
- Tests (`src/m2.test.ts`): 60 distinct cards → alive + gate open + 60 voided; padding dupe rejected; decay past 90d re-locks gate; mapper + filter units.

---
### Earlier (M1) progress

**Done:**
- Specs (functional/technical/data-model/m1-tasks) written.
- **A1** scaffold: package.json, tsconfig strict, vitest, bin `pl`.
- **A2** manifests: `.claude-plugin/plugin.json` (PreToolUse hook), `hooks/build-gate.mjs`, `SKILL.md`. ⚠ hook I/O + plugin schema need validation vs current Claude Code plugin spec before release.
- **A3** store: `src/store/store.ts` (atomic JSON IO, audit JSONL, entity listing) + `src/store/render.ts` (ledger.md mirror). Dumb IO; invariants live in domain.
- **A4** utils: `src/util/id.ts`, `src/util/clock.ts` (injectable + addDaysIso).
- **C2** stats: `src/domain/stats.ts` — Wilson interval + `evaluate()` gates on the CI bound. `src/domain/types.ts` = full entity contract.
- **B3/B4** integrity: `src/domain/integrity.ts` (canonical sha256 hash-lock, tamper→`RegistrationTamperError`) + `src/domain/register.ts` (`freezeRegistration`, passIf>killIf guard).
- **C3** `src/domain/apply.ts`: `applyVerification` = SOLE status writer (verified+fresh evidence → evaluate → tier-gate) + `recomputeLedger` (sole gate.state/verdict writer).
- **D** gate: `src/domain/glob.ts` + `src/domain/gate.ts` (`gateCheck`, `recordOverride`). `src/domain/verdict.ts` mechanical rollup.
- **B1/B2** commands + real CLI: `init`, `hypothesis` (heuristic 4-assumption decompose), `register`, `verify` (stub), `status`, `gate`. `src/cli.ts` dispatches.
- **F1–F4** integrity tests in `src/integrity.test.ts` all pass: e2e lock→open, provided-evidence-can't-open, tier-gate blocks alive, tamper detected, override audited & status untouched.

**Verified e2e:** gate BLOCKS `src/app.ts` (exit 1) → `verify` 60/300 tier-2 pre-auths → gate ALLOWS (exit 0), ledger shows `ALIVE p̂=20.0% CI[15.9%,24.9%]`, verdict SHARPEN.

**Next (pick up here):**
- **`pl experiment run`** — the saga tying it together: renderLanding → HostAdapter.deploy → PaymentAdapter.setupPreauth (wire clientSecret into page) → (M4) AdAdapter launch → counter polling. Idempotent via providerRefs. Then `pl verify` calls runPaymentVerification with the real adapter.
- **Finish real network wiring** (currently skeletons): CloudflarePagesAdapter.deploy (Direct Upload), keytar install, PublicSignalAdapter live fetches.
- **M4 ad runner:** `AdAdapter` (Meta) + budget caps + activation confirm + counter polling → closes the full loop.
- Loose ends: validate plugin/hook vs real Claude Code spec + live-test PreToolUse block; B2 real LLM decomposition (heuristic stays fallback); wire `pl verify` to dispatch stub vs payment vs signal by experiment tier.

**How to run:** `npm test`, `npm run typecheck`, `npm run build`, then `node dist/cli.js help`.

**Decisions log:**
- Host adapter #1 = Cloudflare Pages. Stats = Wilson interval, gate on the bound. Verdict LLM = explanation-only. Editors = Claude Code first.
- Wilson consequence: at n=300, 6 pre-auths is `inconclusive` vs thresholds pass≥5%/kill<2% — needs bigger n to KILL. Narrative docs that said "DEAD 2%" were pre-Wilson illustration.
