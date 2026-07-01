import { createHash } from "node:crypto";
import type { Registration, RegistrationCore } from "./types.js";

/**
 * Deterministic JSON: object keys sorted recursively so the same logical value
 * always serializes to the same bytes. Required for a stable hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** The frozen fields a registration hash commits to (goalposts + when). */
export function registrationCore(r: Registration | RegistrationCore): RegistrationCore {
  return {
    assumptionId: r.assumptionId,
    metric: r.metric,
    sampleTarget: r.sampleTarget,
    passIf: r.passIf,
    killIf: r.killIf,
    confidence: r.confidence,
    frozenAt: r.frozenAt,
  };
}

/** sha256 over the canonical core, prefixed so the algorithm is explicit on disk. */
export function hashRegistration(r: Registration | RegistrationCore): string {
  const digest = createHash("sha256")
    .update(canonicalJson(registrationCore(r)))
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * A registration's stored hash must match a fresh hash of its core. A mismatch
 * means the frozen bet was edited on disk — goalpost-moving — and the caller
 * must quarantine + hard-lock the gate. This is invariant #2 (data-model §4).
 */
export function isRegistrationIntact(r: Registration): boolean {
  return r.hash === hashRegistration(r);
}

export class RegistrationTamperError extends Error {
  constructor(public readonly registrationId: string) {
    super(
      `registration ${registrationId} failed integrity check: frozen thresholds were modified on disk`,
    );
    this.name = "RegistrationTamperError";
  }
}

/** Read-guard: throw if a registration has been tampered with. */
export function assertIntact(r: Registration): void {
  if (!isRegistrationIntact(r)) throw new RegistrationTamperError(r.id);
}
