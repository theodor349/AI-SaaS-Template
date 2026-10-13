/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://clerk.example";
beforeEach(() => vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer));
afterEach(() => vi.unstubAllEnvs());

test.each([
  { firstName: " Alice ", lastName: " Example ", expected: "Alice Example" },
  { firstName: "Alice", expected: "Alice" },
  { lastName: "Example", expected: "Example" },
  { expected: null },
])("display name defaults to the available provider names: $expected", async ({ expected, ...names }) => {
  const t = convexTest(schema, modules);
  const current = await t.mutation(internal.users.syncProfile, {
    profile: { clerkId: "alice", email: "alice@example.com", ...names, updatedAt: 1 }, eventAt: 1,
  });
  expect(current).toMatchObject({ status: "ready", user: { displayName: expected } });
  const user = await t.run(ctx => ctx.db.query("users").take(1));
  expect(user[0].firstName).toBeUndefined();
  expect(user[0].lastName).toBeUndefined();
});

test.each([true, false])("existing names remain readable and survive synchronization (edited: %s)", async profileEdited => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|alice`, clerkId: "alice", email: "alice@example.com",
    firstName: "Legacy", lastName: "Name", profileEdited,
    lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
  }));
  const alice = t.withIdentity({ issuer, subject: "alice" });
  expect(await alice.query(api.users.current, {})).toMatchObject({ status: "ready", user: { displayName: "Legacy Name" } });
  await t.mutation(internal.users.syncProfile, {
    profile: { clerkId: "alice", email: "new@example.com", firstName: "Provider", lastName: "Name", updatedAt: 2 }, eventAt: 2,
  });
  expect(await alice.query(api.users.current, {})).toMatchObject({ status: "ready", user: {
    email: "new@example.com", displayName: profileEdited ? "Legacy Name" : "Provider Name",
  } });
  const user = await t.run(ctx => ctx.db.get("users", userId));
  expect(user?.firstName).toBeUndefined();
  expect(user?.lastName).toBeUndefined();
});

test("saving or clearing a legacy profile removes its separate names", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|alice`, clerkId: "alice", email: "alice@example.com",
    firstName: "Legacy", lastName: "Name", lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
  }));
  const alice = t.withIdentity({ issuer, subject: "alice" });
  await alice.mutation(api.profile.save, { displayName: "  Custom name  " });
  expect(await alice.query(api.users.current, {})).toMatchObject({ status: "ready", user: { displayName: "Custom name" } });
  const user = await t.run(ctx => ctx.db.get("users", userId));
  expect(user?.firstName).toBeUndefined();
  expect(user?.lastName).toBeUndefined();
  await alice.mutation(api.profile.save, { displayName: "  " });
  expect(await alice.query(api.users.current, {})).toMatchObject({ status: "ready", user: { displayName: null } });
});
