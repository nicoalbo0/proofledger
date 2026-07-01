import { customAlphabet } from "nanoid";

// URL-safe, no lookalike chars; short but collision-safe for a single repo's ledger.
const gen = customAlphabet("23456789abcdefghijkmnpqrstuvwxyz", 8);

export type IdPrefix = "h" | "a" | "r" | "x" | "e";

/** Prefixed, human-readable id, e.g. newId("r") -> "r_k7m2p9qd". */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${gen()}`;
}
