# Summary

<!-- What does this change and why? -->

## Changes

-

## Integrity checklist
ProofLedger lives or dies on the gate being un-gameable. Confirm:

- [ ] `Assumption.status` is still written **only** by `applyVerification`.
- [ ] `gate.state` is still written **only** by `recomputeLedger`.
- [ ] No path lets an LLM or founder-supplied value set a status directly.
- [ ] A gating assumption can still only go `alive` on verified evidence at tier ≥ 2.
- [ ] Frozen registrations remain hash-locked (tamper → quarantine).

## Testing
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Added/updated tests for this change

## Docs
- [ ] Updated `docs/` and/or `CLAUDE.md` if behavior or architecture changed
