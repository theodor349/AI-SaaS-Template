import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { hasErrorCode } from "./lib/errors";
import schema from "./schema";
import { modules } from "./test.setup";

const issuer = "https://clerk.example";

beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|alice`, clerkId: "alice", email: "alice@example.com",
    displayName: "Alice", lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
  }));
  return { t, userId, alice: t.withIdentity({ issuer, subject: "alice" }) };
}

const failureOf = (call: Promise<unknown>) => call.then(() => null, (error: unknown) => error);

test("maintenance mode refuses public mutations and actions before they change anything", async () => {
  vi.stubEnv("MAINTENANCE_MODE", "1");
  const { t, userId, alice } = await setup();

  expect(hasErrorCode(await failureOf(alice.mutation(api.account.profile.save, { displayName: "Changed" })), "MAINTENANCE_MODE")).toBe(true);
  expect(hasErrorCode(await failureOf(alice.action(api.account.users.ensureCurrentUser, {})), "MAINTENANCE_MODE")).toBe(true);
  expect((await t.run((ctx) => ctx.db.get(userId)))?.displayName).toBe("Alice");
});

test("maintenance mode keeps queries and internal functions running", async () => {
  vi.stubEnv("MAINTENANCE_MODE", "1");
  const { t, alice } = await setup();

  expect(await alice.query(api.account.users.current, {})).toMatchObject({ status: "ready" });
  await t.mutation(internal.featureFlags.setOverride, { key: "notePinning", enabled: true });
  expect(await t.query(api.featureFlags.current, {})).toMatchObject({ notePinning: true });
});

test("public mutations run when maintenance mode is off", async () => {
  const { t, userId, alice } = await setup();
  await alice.mutation(api.account.profile.save, { displayName: "Changed" });
  expect((await t.run((ctx) => ctx.db.get(userId)))?.displayName).toBe("Changed");
});
