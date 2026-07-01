import type { Assumption, Hypothesis, Ledger } from "../domain/types.js";

const STATUS_DOT: Record<Assumption["status"], string> = {
  alive: "🟢 ALIVE",
  dead: "🔴 DEAD",
  decayed: "🟠 DECAYED",
  inconclusive: "🟡 INCONCL",
  untested: "⚪ UNTESTED",
};

/**
 * Render the read-only ledger.md mirror. Human/diff-friendly; never hand-edited.
 * Pure function of state so it is trivially testable.
 */
export function renderLedgerMd(ledger: Ledger, hypotheses: Hypothesis[]): string {
  const lines: string[] = [];
  lines.push("# Proof Ledger", "");
  lines.push("> Auto-generated mirror of ledger.json. Do not edit by hand.", "");

  const active = hypotheses.find((h) => h.id === ledger.activeHypothesisId);
  const gate = ledger.gate;
  lines.push(`**Build gate:** ${gate.state === "open" ? "🔓 OPEN" : "🔒 LOCKED"} — ${gate.reason || "n/a"}`);
  lines.push("");

  for (const h of hypotheses) {
    const verdict = ledger.verdicts[h.id]?.verdict ?? "PENDING";
    const marker = h.id === active?.id ? " (active)" : "";
    lines.push(`## ${h.claim}${marker}`);
    lines.push(`Verdict: **${verdict}**  ·  status: ${h.status}`, "");
    lines.push("| Assumption | Gate | Status | Note |");
    lines.push("|---|---|---|---|");
    for (const a of h.assumptions) {
      lines.push(
        `| ${a.text} | ${a.gate ? "◆" : ""} | ${STATUS_DOT[a.status]} | ${a.note ?? ""} |`,
      );
    }
    const expl = ledger.verdicts[h.id]?.explanation;
    if (expl) lines.push("", expl);
    lines.push("");
  }

  return lines.join("\n");
}
