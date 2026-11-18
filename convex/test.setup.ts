/// <reference types="vite/client" />
import { expect } from "vitest";

// The modules convex-test loads. Globbed from the convex root so a test in any
// folder registers every function; the multi-dot name keeps Convex from deploying it.
export const modules = import.meta.glob("./**/*.ts");

// convex-test, like Convex, never starts a transaction at a time before the last
// commit. Under a frozen fake clock, commits in the same millisecond move later
// transactions' Date.now() ahead of the test's, by a millisecond per two commits.
// This bounds that lead for a single test.
export const maxServerClockLead = 1000;

// Matches a time a function recorded as its "now" while the test's clock read `time`.
export const serverTime = (time: number) =>
  expect.toSatisfy((value: number) => value >= time && value <= time + maxServerClockLead, `a server time at or just after ${time}`);
