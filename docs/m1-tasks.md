# ProofLedger — M1 Task Breakdown (Ledger Core + Build Gate)

> Goal of M1: prove the **integrity model** end-to-end with *no real external APIs*. A founder can frame a hypothesis, freeze a bet, feed evidence through the verifier interface (stub verifier in M1), and have the build gate lock/unlock deterministically off verified status. If M1 feels honest and un-gameable, the real adapters (M2+) just swap the stub.
>
> Stack: TypeScript / Node 20+, single npm package exposing CLI `pl` + a Claude Code plugin. Flat-JSON store. Vitest for tests. No DB, no server.

## Definition of done for M1
- `pl init → hypothesis → register → (feed stub evidence) → verify → status` runs on a fresh repo.
- Build gate blocks a Write to `src/**` while the gating node is not `alive`; allows it once a stub *verified* Tier-2 evidence flips the node `alive`.
- Registration is hash-locked; tampering quarantines + hard-locks.
- Invariants 1–3, 7 (data-model §4) covered by tests.
- Dogfood: run the flow on ProofLedger's own repo.

---

## Epic A — Project scaffold
- **A1** Init npm package, TS strict, Vitest, lint. Bin entry `pl`. `[S]`
- **A2** Plugin manifest + `skills add` manifest so it installs like the topic repos. `[S]`
- **A3** `Store` module: typed read/write for each entity, atomic writes, `ledger.md` renderer. `[M]` → *blocks most others*
- **A4** ID + clock utils (prefixed nanoid, injectable `now()` for deterministic tests). `[S]`

## Epic B — Ledger core
- **B1** `Config` load/default + `pl init` (scaffold `.proofledger/`, capture motivation, write config). `[M]` — blockedBy A3
- **B2** `Hypothesis` model + `pl hypothesis "<claim>"`: LLM decomposes into ranked assumptions, marks exactly one `gate` node, sets `minTier`. Pure-function fallback if no LLM key. `[M]` — blockedBy A3
- **B3** `Registration` + `pl register`: interactive freeze of metric/sample/passIf/killIf, compute + store `hash`. Immutable-write guard. `[M]` — blockedBy A3
- **B4** Hash verification on every registration read; quarantine + hard-lock on mismatch. `[S]` — blockedBy B3

## Epic C — Verification + status (integrity core)
- **C1** `Verifier` interface `verify(experiment) → Evidence[]` + an M1 **StubVerifier** (reads a local `evidence-input.json` and marks it `verified/tierN` to simulate a source re-fetch). `[M]` — blockedBy A3
- **C2** Stats: Wilson score interval; `evaluate(metricValue,n,registration) → alive|dead|inconclusive`. Unit-tested against known values. `[M]`
- **C3** `applyVerification(assumption)` — the **only** writer of `status`. Wires C1+C2, handles decay (`expiresAt`), writes `audit status` events. `[M]` — blockedBy C1,C2
- **C4** `pl verify` command: run verifier for active experiment, call `applyVerification`, persist. `[S]` — blockedBy C3

## Epic D — Build gate
- **D1** `GateHook` interface + Claude Code PreToolUse adapter; `pl init` registers it. `[M]` — blockedBy A3
- **D2** `gate-check` entry: match path vs `productGlobs`, read gating node status, ALLOW/BLOCK with reason. `[M]` — blockedBy D1,C3
- **D3** `pl gate` (explain state) + `pl gate --override "<reason>"` with audit `gate_override`. `[S]` — blockedBy D2
- **D4** Gate re-locks when gating node is `decayed`. `[S]` — blockedBy D2,C3

## Epic E — Verdict + presentation
- **E1** Mechanical verdict rollup (data-model §3.4) → `PENDING/SHIP/SHARPEN/PIVOT/KILL`. `[S]` — blockedBy C3
- **E2** `explain(ledger) → string` LLM layer; receives statuses, writes prose + next-cheapest-test. Must not touch status (enforced by type + test). `[S]` — blockedBy E1
- **E3** `pl status` scoreboard renderer (the boxed output in functional-spec §4.6). `[M]` — blockedBy E1

## Epic F — Integrity tests (gate for shipping M1)
- **F1** Invariant test: only `applyVerification` writes `status`; only gate module writes `gate.state`. `[M]`
- **F2** "Cannot type past the gate": feeding `assumed`/`provided` evidence never opens the gate; only `verified` tier≥2 does. `[M]`
- **F3** Tamper test: editing a frozen registration on disk → quarantine + hard-lock. `[S]`
- **F4** E2E: init→hypothesis→register→verify(stub)→status, gate locked then open. `[M]`

---

## Suggested order
```
A1 A4 → A3 → A2
        ├─ B1 B2 B3 → B4
        ├─ C1 C2 → C3 → C4
        ├─ D1 → D2 → D3, D4
        └─ E1 → E2, E3
then F1–F4 (some written alongside their epics)
```

## Explicitly NOT in M1 (later milestones)
- Real Stripe / ad / host / survey / transcript adapters → M2–M4 (swap StubVerifier).
- Tier-0 `SignalAdapter` (impact-compass-style public scoring) → M3.
- Longitudinal export / investor view → M5.
- Codex / Cursor gate adapters → after Claude Code proven.

## Sizing legend
`[S]` ≈ ½–1 day · `[M]` ≈ 1–2 days. M1 ≈ 2–3 focused weeks solo.
