#!/usr/bin/env node
// PreToolUse hook: block Write/Edit/MultiEdit to gated product code until the
// build gate is open. Thin wrapper — all decision logic lives in (and is tested
// via) dist/hook/gate-hook.js.
import { Store } from "../dist/store/store.js";
import { gateHookDecision, denyOutput } from "../dist/hook/gate-hook.js";

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

const store = new Store(payload?.cwd || process.cwd());
const { block, reason } = gateHookDecision(store, payload);
if (!block) process.exit(0);

console.log(denyOutput(reason));
process.exit(2);
