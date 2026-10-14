import { cookies } from "next/headers";

export const E2E_CRASH_COOKIE = "e2e-crash";

type CrashTarget = "page" | "layout" | "client";

// Lets E2E tests reach the error boundaries: true while the test's cookie names this
// target. Inert unless bootstrap sets E2E_TEST_ROUTES, which deployments never do, and
// it skips the cookie read then so pages stay static.
export async function e2eCrashRequested(target: CrashTarget) {
  if (process.env.E2E_TEST_ROUTES !== "1") return false;
  return (await cookies()).get(E2E_CRASH_COOKIE)?.value === target;
}

export async function throwIfE2ECrashRequested(target: "page" | "layout") {
  if (await e2eCrashRequested(target)) {
    throw new Error(`E2E ${target} crash with an internal detail`);
  }
}
