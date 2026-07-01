---
name: proofledger
description: >-
  Validate a startup idea with machine-verified real-world evidence before
  writing product code. Use when a founder wants to test whether strangers will
  actually pay, gate coding on proof, register a falsifiable bet, or read the
  proof ledger. Refuses to let product code be written until a gating assumption
  is confirmed by verified evidence (real Stripe pre-auths), not self-reported.
---

# ProofLedger

Local-first startup validation that gates coding on verified real-money evidence.
Runs entirely on the founder's own provider accounts; no server.

## Workflow
1. `proofledger init "<motivation>"` — scaffold `.proofledger/` and install the build gate.
2. `proofledger hypothesis "<who> will <do what> because <why>"` — decompose into risky
   assumptions; exactly one is the gating (usually "will pay") node.
3. `proofledger register --metric <m> --sample <n> --pass <x> --kill <y>` — freeze a
   falsifiable bet. Thresholds are hash-locked; moving them needs a new
   registration, never an edit.
4. Run a real experiment (ads → landing → Stripe pre-auth), then `proofledger verify` to
   re-fetch and count only machine-verified artifacts.
5. `proofledger status` — read the scoreboard + verdict. The build gate opens only when
   the gating assumption is `alive` on verified evidence at tier ≥ 2 (real money).

## Rules for the agent
- Never mark an assumption alive/dead yourself — only `proofledger verify` changes status.
- Never advise editing a frozen registration to "make it pass"; use `proofledger register`
  to supersede (audited).
- If the gate blocks a write, do not bypass it silently. Report what evidence is
  missing and which experiment to run.
