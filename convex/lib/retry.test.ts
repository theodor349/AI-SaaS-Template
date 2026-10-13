import { expect, test } from "vitest";
import { isLeased, leaseDeadline, leaseMs, retryDelay } from "./retry";

test("retry delay doubles per attempt and is capped at one hour", () => {
  expect([1, 2, 3].map(retryDelay)).toEqual([2000, 4000, 8000]);
  expect(retryDelay(11)).toBe(2048 * 1000);
  expect(retryDelay(12)).toBe(60 * 60_000);
  expect(retryDelay(1000)).toBe(60 * 60_000);
});

test("a lease is held only until its deadline", () => {
  const now = 1_000_000;
  const until = leaseDeadline(now);
  expect(until).toBe(now + leaseMs);
  expect(isLeased(until, until - 1)).toBe(true);
  expect(isLeased(until, until)).toBe(false);
  expect(isLeased(0, now)).toBe(false);
  expect(isLeased(undefined, now)).toBe(false);
});
