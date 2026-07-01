import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../store/store.js";
import { fixedClock } from "../util/clock.js";
import { initRepo } from "../commands/init.js";
import { addHypothesis } from "../commands/hypothesis.js";
import { registerBet } from "../commands/register.js";
import { verifyStub } from "../commands/verify.js";
import { gatingAssumption } from "../domain/verdict.js";
import { denyOutput, gateHookDecision } from "./gate-hook.js";

const T0 = fixedClock("2026-07-01T00:00:00.000Z");
let root: string, store: Store, gateId: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pl-hook-"));
  store = new Store(root);
  initRepo(store, "t", T0);
  const h = addHypothesis(store, "users will pre-pay for X", T0);
  gateId = gatingAssumption(h)!.id;
  registerBet(store, { assumptionId: gateId, metric: "preauth_conversion", sampleTarget: 300, passIf: { op: ">=", value: 0.1 }, killIf: { op: "<", value: 0.05 } }, T0);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("gateHookDecision (PreToolUse mechanics)", () => {
  it("BLOCKS a write to product code while the gate is locked", () => {
    const d = gateHookDecision(store, { tool_input: { file_path: "src/app.ts" } });
    expect(d.block).toBe(true);
  });

  it("ALLOWS a write to a non-product path", () => {
    expect(gateHookDecision(store, { tool_input: { file_path: "README.md" } }).block).toBe(false);
  });

  it("BLOCKS an ABSOLUTE product path (Claude Code passes absolute)", () => {
    // Regression: absolute paths must be relativized against cwd before glob match.
    const abs = join(root, "src", "app.ts");
    expect(gateHookDecision(store, { tool_input: { file_path: abs }, cwd: root }).block).toBe(true);
  });

  it("ALLOWS once verified money opens the gate", () => {
    verifyStub(store, [{ assumptionId: gateId, tier: 2, type: "stripe_preauth", clicks: 300, successes: 60 }], T0);
    expect(gateHookDecision(store, { tool_input: { file_path: "src/app.ts" } }).block).toBe(false);
  });

  it("fails open when no file path or no ledger", () => {
    expect(gateHookDecision(store, {}).block).toBe(false);
    const empty = new Store(mkdtempSync(join(tmpdir(), "pl-empty-")));
    expect(gateHookDecision(empty, { tool_input: { file_path: "src/app.ts" } }).block).toBe(false);
  });

  it("denyOutput emits the PreToolUse deny shape", () => {
    const out = JSON.parse(denyOutput("gate locked"));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("gate locked");
  });
});
