import { expect, test } from "vitest";
import { isSignUpSession } from "./install-offer";

const signedUpAt = new Date("2026-10-15T10:00:00Z");

test("only the session sign-up created counts as the sign-up session", () => {
  expect(isSignUpSession(signedUpAt, new Date("2026-10-15T10:00:01Z"))).toBe(true);
  // A later sign-in, here or on another device.
  expect(isSignUpSession(signedUpAt, new Date("2026-10-16T09:00:00Z"))).toBe(false);
  expect(isSignUpSession(null, signedUpAt)).toBe(false);
});
