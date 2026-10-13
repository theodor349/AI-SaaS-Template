// Shared timing for leased background work: billing reconciliation, billing
// operations, and account lifecycle processing.

// How long a worker owns a job before a sweep may hand it to another worker.
export const leaseMs = 120_000;

export function leaseDeadline(now = Date.now()) {
  return now + leaseMs;
}

// A lease is held until its deadline passes. Absent or zero means unleased.
export function isLeased(leaseUntil: number | undefined, now = Date.now()) {
  return (leaseUntil ?? 0) > now;
}

// Exponential backoff after consecutive failures: 2s, 4s, 8s, ... capped at one hour.
export function retryDelay(attempts: number) {
  return Math.min(60 * 60_000, 1000 * 2 ** Math.min(attempts, 12));
}
