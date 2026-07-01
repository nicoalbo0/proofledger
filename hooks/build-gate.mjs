#!/usr/bin/env node
// PreToolUse hook: block Write/Edit/MultiEdit to gated product code until the
// build gate is open. Reads the Claude Code hook payload from stdin.
//
// NOTE: manifest + hook I/O shape should be validated against the current
// Claude Code plugin spec before release (tracked in CLAUDE.md M1 follow-ups).
import { Store } from "../dist/store/store.js";
import { gateCheck } from "../dist/domain/gate.js";

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
  });
}

const raw = await readStdin();
let payload = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  process.exit(0); // can't parse -> don't obstruct
}

const filePath = payload?.tool_input?.file_path;
const cwd = payload?.cwd || process.cwd();
if (!filePath) process.exit(0);

const store = new Store(cwd);
if (!store.isInitialized()) process.exit(0); // no ledger here -> not our concern

const { decision, reason } = gateCheck(store, filePath);
if (decision === "allow") process.exit(0);

// Block: emit the documented PreToolUse deny shape + a non-zero exit as fallback.
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `ProofLedger: ${reason}`,
    },
  }),
);
process.exit(2);
