# ProofLedger

**Every rival grades your startup idea with an LLM's guess. ProofLedger runs the real ad, takes the real pre-payment, and won't let you write product code until strangers actually paid.**

Local-first. No server we operate — it runs on your machine and your own provider
accounts (Stripe, ad platform, static host). A Claude Code plugin + CLI that gates
coding on **machine-verified real-world evidence**, not opinion.

> In 2026, agentic coding makes it faster than ever to build something nobody
> wants. ProofLedger is the brake: prove demand with real money first.

---

## Why it's different

Most startup-validation tools produce an LLM's *opinion* about your market.
Evidence-gate tools go further but trust *self-reported* proof ("I talked to 5
people"). ProofLedger counts **only artifacts a machine re-fetches and verifies** —
and only real money opens the gate.

| Approach | What it proves |
|---|---|
| Critic / consultant bots | An LLM's guess |
| Evidence gates (self-reported) | That you *said* you have proof |
| Synthetic-user simulators | That fake users "agree" |
| **ProofLedger** | **That real strangers put a real card down** |

## The evidence ladder

| Tier | Test | Cost | Opens the gate? |
|---|---|---|---|
| 0 | Free public desk signal (deterministic, red-ocean penalty) | $0 | No — can only *kill* |
| 1 | Fake-door landing + email | ~$0 | No |
| 2 | **Stripe pre-authorization (real money)** | ad spend | **Yes** |
| 3 | Captured sale | real | Yes (opt-in) |

A gating assumption goes `alive` **only** on verified evidence at tier ≥ 2. The
build gate — a Claude Code PreToolUse hook — blocks writes to your product code
until then.

## Install

```bash
npm install -g proofledger        # CLI `pl`
# or install as a Claude Code plugin (build gate auto-registers)
```

## Quickstart

```bash
pl init "why I'm building this"
pl hypothesis "diabetics will pre-pay \$15/mo for AI meal planning"

# Freeze a falsifiable bet — thresholds are hash-locked, no goalpost-moving.
pl register --metric preauth_conversion --sample 300 --pass 0.05 --kill 0.02

# Optional free Tier-0 screen first (kills obviously-dead ideas for $0):
pl connect stripe --secret sk_... --publishable pk_...
pl signal --assumption <demand-id> --keywords "diabetes,meal planning" --competitors "mynetdiary"

# Run the real experiment: landing page on YOUR host, ads on YOUR account,
# pre-auth on YOUR Stripe. Ads start PAUSED; nothing spends until you confirm.
pl experiment run --assumption <pay-id> --price 15 \
  --headline "Meal plans that count carbs for you" \
  --keywords "diabetes,meal planning" --daily 20 --days 5 --activate true

pl verify --experiment <id>   # re-fetch pre-auths, dedupe, void the holds
pl status                      # scoreboard + verdict; gate opens iff money verified
```

## What you get

```
┌─ PROOF LEDGER ─────────────────────────────────────┐
│ VERDICT: SHARPEN                                    │
│ BUILD GATE: 🔓 OPEN — "will pay" is alive           │
│  ● demand ....... ALIVE                             │
│  ● will pay $15 . ALIVE   p̂=20.0% CI[15.9%,24.9%]  │
│ Evidence: 60 verified Stripe pre-auths (voided)     │
└─────────────────────────────────────────────────────┘
```

## Integrity guarantees

- One function writes assumption status; one writes the gate. No LLM, ever.
- Registrations are **hash-locked** — editing a frozen bet trips a quarantine.
- Verified success is counted only from **re-fetched artifacts**; padding with the
  same card, wrong state, or wrong tag is filtered out.
- Pre-auths are **voided** after counting — a signal, not a charge (capture is opt-in).
- Secrets live in the OS keychain / a 0600 file — never in the repo.

## Status

Early (`0.1.x`). Core ledger, gate, hash-lock, Tier-0 signal, Stripe verification,
and the experiment saga are built and tested. Real Cloudflare/Meta network wiring
is in progress — see [`docs/`](docs/) and [`CLAUDE.md`](CLAUDE.md).

## Docs

- [`docs/functional-spec.md`](docs/functional-spec.md)
- [`docs/technical-spec.md`](docs/technical-spec.md)
- [`docs/data-model.md`](docs/data-model.md)
- [`docs/smoke-test.md`](docs/smoke-test.md) — live Stripe/Cloudflare/Meta checks

## License

[Apache-2.0](LICENSE) © 2026 Nicola Albore
