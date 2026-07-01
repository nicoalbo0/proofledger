import { isAbsolute, relative } from "node:path";
import type { Store } from "../store/store.js";
import { gateCheck } from "../domain/gate.js";

// The PreToolUse hook payload shape we depend on (Claude Code passes more; we
// only read these two fields).
export interface HookPayload {
  tool_input?: { file_path?: string };
  cwd?: string;
}

export interface HookDecision {
  block: boolean;
  reason: string;
}

/**
 * Decide whether a Write/Edit should be blocked, given a hook payload and a
 * store. Pure over (store, payload) so it is unit-testable without spawning a
 * subprocess. The .mjs wrapper only handles stdin/stdout/exit around this.
 *
 * Fail-open by design: if there is no file path or no initialized ledger, we do
 * not obstruct the tool call.
 */
export function gateHookDecision(store: Store, payload: HookPayload): HookDecision {
  const filePath = payload?.tool_input?.file_path;
  if (!filePath) return { block: false, reason: "no file path" };
  if (!store.isInitialized()) return { block: false, reason: "no ledger here" };
  // Claude Code passes an ABSOLUTE file path; productGlobs are repo-relative.
  // Relativize against the project root (the hook payload's cwd) before matching.
  const cwd = payload.cwd ?? process.cwd();
  const rel = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
  const d = gateCheck(store, rel);
  return { block: d.decision === "block", reason: d.reason };
}

/** The deny payload Claude Code expects from a PreToolUse hook. */
export function denyOutput(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `ProofLedger: ${reason}`,
    },
  });
}
