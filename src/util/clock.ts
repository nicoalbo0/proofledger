/**
 * Injectable clock. Real code passes the default; tests pass a fixed clock so
 * timestamps and decay math are deterministic.
 */
export interface Clock {
  now(): Date;
  iso(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  iso: () => new Date().toISOString(),
};

/** Fixed clock for tests. */
export function fixedClock(at: string | Date): Clock {
  const d = typeof at === "string" ? new Date(at) : at;
  return {
    now: () => new Date(d),
    iso: () => d.toISOString(),
  };
}

/** Add days to an ISO instant, returning an ISO instant. Used for decay expiry. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
