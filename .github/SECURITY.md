# Security Policy

## Reporting a vulnerability

Please report security issues **privately** via
[GitHub Security Advisories](https://github.com/nicoalbo0/proofledger/security/advisories/new).
Do not open a public issue for a vulnerability.

We aim to acknowledge within 72 hours.

## Scope — what matters most

ProofLedger runs **locally on the founder's machine** and talks to the founder's
own provider accounts (Stripe, ad platforms, static host). We operate no server.
The highest-severity classes for this project:

1. **Gate bypass / status forgery** — any way to make an assumption `alive`, or
   open the build gate, without verified evidence at tier ≥ 2. This defeats the
   product's core promise.
2. **Registration tamper that escapes detection** — editing frozen thresholds
   without tripping the hash-lock quarantine.
3. **Secret exposure** — provider keys leaking into the repo, `.proofledger/`,
   logs, or the generated landing page. Secrets must stay in the OS keychain or
   the 0600 file store.
4. **Landing-page abuse** — generated pages that could charge a card without the
   "authorized, not charged" disclosure, or otherwise mislead visitors.

## Supported versions

Pre-1.0: only the latest minor release receives fixes.
