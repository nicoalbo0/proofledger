# Contributing to ProofLedger

Thanks for helping. ProofLedger has one non-negotiable design principle, and most
review effort goes into protecting it.

## The prime directive

**Only machine-verified evidence may change an assumption's status, and only real
money (tier ≥ 2) may open the build gate.** If a change lets an LLM, a
founder-typed number, or unverified input move a status or open the gate, it will
be rejected — no matter how convenient.

Concretely:
- `Assumption.status` is written **only** by `applyVerification` (`src/domain/apply.ts`).
- `gate.state` is written **only** by `recomputeLedger`.
- Frozen registrations are hash-locked (`src/domain/integrity.ts`); tampering must
  quarantine and hard-lock.

Touching `src/domain/apply.ts`, `integrity.ts`, or `verify-core.ts`? Expect a
close review and add tests that prove the gate stays un-gameable.

## Dev setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run the CLI from source: `npm run cli -- help`.

## Conventions

- TypeScript, strict mode. No `as any`, no `@ts-ignore`.
- Keep domain logic pure and testable; push I/O into adapters behind interfaces.
- Real provider calls stay behind adapters with a `Fake*` for tests. Never require
  live credentials to run the suite.
- Every behavior change ships with a test. Integrity-sensitive changes ship with a
  test that would fail if the gate could be bypassed.
- Update `docs/` and `CLAUDE.md` when architecture or behavior changes.

## Commits & PRs

- Conventional-ish commit subjects (`feat:`, `fix:`, `docs:` …), ≤ 50 chars.
- Fill in the PR template, including the **Integrity checklist**.
- CI (typecheck + test + build on Node 20 & 22) must be green.

## Reporting security issues

See [SECURITY.md](.github/SECURITY.md) — report privately, never as a public issue.
