# Changelog

All notable changes to ProofLedger are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Core ledger: hypotheses, risky assumptions, hash-locked registrations, verdicts.
- Build gate (Claude Code PreToolUse hook) blocking product-code writes until a
  gating assumption is `alive` on verified evidence at tier ≥ 2.
- Integrity core: single writer for assumption status (`applyVerification`) and
  gate state (`recomputeLedger`); registration tamper detection.
- Wilson-interval evaluator — pass/kill decided on the confidence bound.
- Evidence ladder: Tier-0 deterministic public-signal scorer (log-scaled,
  red-ocean penalty), Tier-2 Stripe pre-auth verification with card-fingerprint
  dedupe and auto-void.
- Experiment saga (`pl experiment run`): render landing → deploy → pre-auth →
  ad campaign; idempotent, budget-capped, activation opt-in and audited.
- Network adapters: Cloudflare Worker host, Meta Graph ads (campaign→adset→
  creative→ad), public signal fetch, keychain/file secrets.
- CLI: `init, connect, doctor, hypothesis, register, signal, experiment run|poll,
  verify, decay, status, pivot, export, gate, version`.
- `pl doctor [--ping]` credential check; `pl export` shareable report surfacing
  gate overrides.
- Live smoke suites (env-gated) for Stripe test mode and Cloudflare.

### Validated
- Stripe (test mode) and Cloudflare (free Worker) pass live against real APIs.
- Meta ads unit-tested (payloads + call sequence); live run pending.

[Unreleased]: https://github.com/nicola-albore/proofledger/commits/main
