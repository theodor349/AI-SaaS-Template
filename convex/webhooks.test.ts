/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { defineSchema, defineTable, makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { Webhook } from "svix";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import schema from "./schema";
import { DELIVERY_RETENTION_MS, processDelivery } from "./webhooks";
import { apply as applyClerk, process as processClerk } from "./clerkWebhooks";

const issuer = "https://test.clerk.accounts.dev";
const secret = `whsec_${btoa("a sufficiently long test signing secret")}`;
const modules = import.meta.glob("./**/*.ts");
// Billing owns its eventual fields. Extend the test schema to prove the profile
// writer preserves a downstream domain's paid entitlement and application data.
const extendedSchema = defineSchema({
  ...schema.tables,
  users: defineTable(schema.tables.users.validator.extend({
    paidEntitlement: v.optional(v.literal("pro")),
    applicationPreference: v.optional(v.string()),
  })).index("by_tokenIdentifier", ["tokenIdentifier"]).index("by_clerkId", ["clerkId"]),
});
const setup = () => convexTest(extendedSchema, modules);

function profile(id = "user_a", updatedAt = 100) {
  return { id, updated_at: updatedAt, primary_email_address_id: "email_primary",
    email_addresses: [{ id: "email_other", email_address: "other@example.com" },
      { id: "email_primary", email_address: "primary@example.com" }],
    first_name: "Alice", last_name: null,
  };
}
function event(data: unknown = profile(), timestamp = 110, type = "user.created") {
  return { type, timestamp, data };
}
async function send(t: ReturnType<typeof setup>, body: unknown, id = "msg_1", valid = true) {
  const payload = JSON.stringify(body);
  const date = new Date();
  return t.fetch("/webhooks/clerk", { method: "POST", body: payload,
    headers: { "svix-id": id, "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
      "svix-signature": valid ? new Webhook(secret).sign(id, date, payload) : "v1,bad", },
  });
}
async function rows(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => ({ users: await ctx.db.query("users").take(20),
    deliveries: await ctx.db.query("webhookDeliveries").take(20),
    requests: await ctx.db.query("accountLifecycleRequests").take(20),
  }));
}

beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", secret);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("signed router requests select the primary email and keep billing fields on profile changes", async () => {
  const t = setup();
  expect((await send(t, event())).status).toBe(200);
  const user = (await rows(t)).users[0];
  expect(user).toMatchObject({ email: "primary@example.com", firstName: "Alice", lifecycle: "active",
    tokenIdentifier: `${issuer}|user_a`, profileUpdatedAt: 100 });
  expect(user.paidEntitlement).toBeUndefined();
  await t.run((ctx) => ctx.db.patch("users", user._id, { paidEntitlement: "pro", applicationPreference: "dark" }));
  const next = { ...profile("user_a", 200), primary_email_address_id: "email_other", first_name: null };
  expect((await send(t, event(next), "msg_2")).status).toBe(200);
  expect((await rows(t)).users).toEqual([expect.objectContaining({
    _id: user._id, email: "other@example.com", paidEntitlement: "pro", applicationPreference: "dark",
  })]);
  expect((await rows(t)).users[0].firstName).toBeUndefined();
});

test("simultaneous signed duplicates create one user and one successful delivery", async () => {
  const t = setup();
  const responses = await Promise.all(Array.from({ length: 6 }, () => send(t, event())));
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
  const state = await rows(t);
  expect(state.users).toHaveLength(1);
  expect(state.deliveries).toHaveLength(1);
  expect(state.deliveries[0]).toMatchObject({ provider: "clerk", status: "success", attempts: 1 });
});

test("older updates, including equal object timestamps, cannot overwrite newer profile state", async () => {
  const t = setup();
  await send(t, event(profile("user_a", 200), 220), "new");
  await send(t, event(profile("user_a", 100), 999), "old");
  await send(t, event({ ...profile("user_a", 200), first_name: "stale" }, 210), "older-tie");
  expect((await rows(t)).users[0]).toMatchObject({ firstName: "Alice", profileUpdatedAt: 200, profileEventAt: 220 });
  await send(t, event({ ...profile("user_a", 200), first_name: "new" }, 230), "newer-tie");
  expect((await rows(t)).users[0].firstName).toBe("new");
});

test("deletion is durable, idempotent, and terminal even before create or after retention", async () => {
  const t = setup();
  const deletion = { type: "user.deleted", timestamp: 300, data: { id: "user_a", deleted: true } };
  await send(t, deletion, "delete");
  await send(t, deletion, "delete-again");
  await send(t, event(profile("user_a", 400)), "late-profile");
  let state = await rows(t);
  expect(state.users).toHaveLength(1);
  expect(state.users[0]).toMatchObject({ lifecycle: "deletion_requested" });
  expect(state.users[0].email).toBeUndefined();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({ status: "pending", source: "clerk", sourceDeliveryId: "delete" });
  await t.run(async (ctx) => {
    for (const row of state.deliveries) await ctx.db.patch("webhookDeliveries", row._id, { expiresAt: 0 });
    await ctx.db.patch("users", state.users[0]._id, { lifecycle: "deleted" });
    await ctx.db.patch("accountLifecycleRequests", state.requests[0]._id, { status: "completed" });
  });
  await t.mutation(internal.webhooks.prune, {});
  await send(t, event(profile("user_a", 500)), "late-profile");
  await send(t, deletion, "delete");
  await send(t, event(profile("user_new", 500)), "new-account");
  state = await rows(t);
  expect(state.users.find((u) => u.clerkId === "user_a")?.lifecycle).toBe("deleted");
  expect(state.users.find((u) => u.clerkId === "user_new")?.lifecycle).toBe("active");
  expect(state.requests).toHaveLength(1);
});

test("deletion preserves the application record for cleanup even when timestamps are reordered", async () => {
  const t = setup();
  await send(t, event(profile("user_a", 400)));
  await send(t, { type: "user.deleted", timestamp: 300, data: { id: "user_a", deleted: true } }, "delete");
  expect((await rows(t)).users[0]).toMatchObject({ lifecycle: "deletion_requested", email: "primary@example.com" });
  await send(t, event(profile("user_a", 500)), "recreate");
  expect((await rows(t)).users[0].lifecycle).toBe("deletion_requested");
});

test("invalid signatures, altered raw bodies, and malformed required fields never mutate state", async () => {
  const t = setup();
  expect((await send(t, event(), "bad-signature", false)).status).toBe(400);
  const date = new Date();
  expect((await t.fetch("/webhooks/clerk", { method: "POST", body: JSON.stringify(event()) + " ", headers: {
    "svix-id": "tampered", "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign("tampered", date, JSON.stringify(event())),
  } })).status).toBe(400);
  for (const bad of [
    { ...profile(), primary_email_address_id: null },
    { ...profile(), primary_email_address_id: "missing" },
    { ...profile(), email_addresses: [] },
    { ...profile(), updated_at: null },
    { ...profile(), first_name: 42 },
    { ...profile(), id: "" },
  ]) expect((await send(t, event(bad))).status).toBe(400);
  expect((await send(t, { type: "user.deleted", timestamp: 300, data: { id: "user_a" } })).status).toBe(400);
  expect(await rows(t)).toEqual({ users: [], deliveries: [], requests: [] });
});

test("valid unhandled event types are deliberately acknowledged and tracked", async () => {
  const t = setup();
  expect((await send(t, { type: "session.created", timestamp: 200, data: {} })).status).toBe(200);
  expect((await rows(t)).users).toEqual([]);
  expect((await rows(t)).deliveries[0].status).toBe("success");
});

test("missing webhook configuration returns a retryable response", async () => {
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
  const t = setup();
  expect((await send(t, event())).status).toBe(503);
  expect((await rows(t)).deliveries).toEqual([]);
});

test("provisioning is identity-derived, retryable, and works without webhooks", async () => {
  const t = setup();
  const alice = t.withIdentity({ issuer, subject: "user_a" });
  const bob = t.withIdentity({ issuer, subject: "user_b" });
  expect(await alice.query(api.users.current, {})).toEqual({ status: "provisioning" });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("failure", { status: 503 }));
  await expect(alice.action(api.users.ensureCurrentUser, {})).rejects.toThrow("PROVISIONING_FAILED");
  expect((await rows(t)).users).toEqual([]);
  fetchMock.mockResolvedValueOnce(Response.json(profile()));
  expect(await alice.action(api.users.ensureCurrentUser, {})).toMatchObject({ status: "ready", user: { email: "primary@example.com" } });
  expect(fetchMock.mock.calls[1][0]).toBe("https://api.clerk.com/v1/users/user_a");
  expect(await bob.query(api.users.current, {})).toEqual({ status: "provisioning" });
  expect((await rows(t)).users[0].paidEntitlement).toBeUndefined();
  await alice.action(api.users.ensureCurrentUser, {});
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await send(t, event(), "delayed-webhook");
  expect((await rows(t)).users).toHaveLength(1);
});

test("anonymous and foreign-issuer callers cannot provision or choose somebody else's identity", async () => {
  const t = setup();
  await expect(t.query(api.users.current, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(t.action(api.users.ensureCurrentUser, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(t.withIdentity({ subject: "user_a", issuer: "https://other.example" })
    .action(api.users.ensureCurrentUser, {})).rejects.toThrow("UNAUTHENTICATED");
  await expect(t.withIdentity({ subject: "user_a", issuer }).query(api.users.current,
    { clerkId: "user_b" } as unknown as Record<string, never>)).rejects.toThrow();
  expect((await rows(t)).users).toEqual([]);
});

test("provider absence and a deletion racing provisioning cannot resurrect an identity", async () => {
  const t = setup();
  const alice = t.withIdentity({ issuer, subject: "user_a" });
  vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
    await send(t, { type: "user.deleted", timestamp: 300, data: { id: "user_a", deleted: true } }, "delete");
    return Response.json(profile("user_a", 400));
  });
  expect(await alice.action(api.users.ensureCurrentUser, {})).toEqual({ status: "deleting" });
  expect(await alice.query(api.users.current, {})).toEqual({ status: "deleting" });
  const bob = t.withIdentity({ issuer, subject: "user_b" });
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 404 }));
  expect(await bob.action(api.users.ensureCurrentUser, {})).toEqual({ status: "deleting" });
  expect((await rows(t)).requests).toHaveLength(2);
});

const applyRef = makeFunctionReference<"mutation", { fail: boolean }, null>("testHandlers:apply") as unknown as FunctionReference<"mutation", "internal", { fail: boolean }, null>;
function setupRecovery() {
  return convexTest(schema, {
    ...modules,
    "./testHandlers.ts": async () => ({
      apply: internalMutation({
        args: { fail: v.boolean() }, returns: v.null(),
        handler: async (ctx, { fail }) => {
          await ctx.db.insert("numbers", { value: 42 });
          if (fail) throw new Error("provider payload details must not be logged");
          return null;
        },
      }),
    }),
  });
}

test("failed handlers roll back effects and remain retryable; provider delivery IDs never collide", async () => {
  const t = setupRecovery();
  const delivery = { provider: "clerk" as const, deliveryId: "shared-id", eventType: "test" };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await t.run((ctx) => processDelivery(ctx, delivery, applyRef, { fail: true }))).toBe("failure");
  expect(await t.run((ctx) => ctx.db.query("numbers").take(10))).toEqual([]);
  expect(log.mock.calls.flat().join(" ")).not.toContain("provider payload");
  expect(await t.run((ctx) => processDelivery(ctx, delivery, applyRef, { fail: false }))).toBe("success");
  expect(await t.run((ctx) => processDelivery(ctx, delivery, applyRef, { fail: false }))).toBe("duplicate");
  expect(await t.run((ctx) => processDelivery(ctx, { ...delivery, provider: "polar" }, applyRef, { fail: false }))).toBe("success");
  const deliveries = await t.run((ctx) => ctx.db.query("webhookDeliveries").take(10));
  expect(deliveries).toHaveLength(2);
  expect(deliveries.find((d) => d.provider === "clerk")).toMatchObject({ status: "success", attempts: 2 });
  expect(deliveries[0].expiresAt - deliveries[0].lastAttemptAt).toBe(DELIVERY_RETENTION_MS);
  expect(await t.run((ctx) => ctx.db.query("numbers").take(10))).toHaveLength(2);
});

test("interruption before completion commits neither effects nor a stuck processing record", async () => {
  const t = setupRecovery();
  const delivery = { provider: "clerk" as const, deliveryId: "interrupted", eventType: "test" };
  await expect(t.run(async (ctx) => {
    await processDelivery(ctx, delivery, applyRef, { fail: false });
    throw new Error("transaction interrupted before commit");
  })).rejects.toThrow("interrupted");
  expect(await t.run((ctx) => ctx.db.query("webhookDeliveries").take(10))).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("numbers").take(10))).toEqual([]);
  expect(await t.run((ctx) => processDelivery(ctx, delivery, applyRef, { fail: false }))).toBe("success");
  expect(await t.run((ctx) => ctx.db.query("numbers").take(10))).toHaveLength(1);
});


test("explicit reconciliation preserves paid fields and rejects provider identity mismatch", async () => {
  const t = setup();
  await send(t, event());
  const user = (await rows(t)).users[0];
  await t.run((ctx) => ctx.db.patch("users", user._id, { paidEntitlement: "pro" }));
  const alice = t.withIdentity({ issuer, subject: "user_a" });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ ...profile("user_a", 500), first_name: "Updated" }));
  expect(await alice.action(api.users.ensureCurrentUser, { refresh: true })).toMatchObject({ status: "ready", user: { firstName: "Updated" } });
  expect((await rows(t)).users[0].paidEntitlement).toBe("pro");
  fetchMock.mockResolvedValueOnce(Response.json(profile("user_b", 600)));
  await expect(alice.action(api.users.ensureCurrentUser, { refresh: true })).rejects.toThrow("PROVISIONING_FAILED");
  expect((await rows(t)).users).toHaveLength(1);
  expect((await rows(t)).users[0].firstName).toBe("Updated");
});

test("signed HTTP handler failures return 503, roll back writes, and recover on redelivery", async () => {
  let failing = true;
  const t = convexTest(extendedSchema, {
    ...modules,
    "./realClerkWebhooks.ts": async () => ({ apply: applyClerk }),
    "./clerkWebhooks.ts": async () => ({
      process: processClerk,
      apply: internalMutation({
        args: { payload: v.string(), deliveryId: v.string() }, returns: v.null(),
        handler: async (ctx, args) => {
          if (!failing) return ctx.runMutation(
            makeFunctionReference<"mutation", { payload: string; deliveryId: string }, null>("realClerkWebhooks:apply"), args,
          );
          await ctx.db.insert("numbers", { value: 42 });
          throw new Error("temporary failure");
        },
      }),
    }),
  });
  expect((await send(t, event())).status).toBe(503);
  expect((await rows(t)).users).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("numbers").take(10))).toEqual([]);
  expect((await rows(t)).deliveries[0]).toMatchObject({ status: "failure", attempts: 1 });
  failing = false;
  expect((await send(t, event())).status).toBe(200);
  expect((await rows(t)).users).toHaveLength(1);
  expect((await rows(t)).deliveries[0]).toMatchObject({ status: "success", attempts: 2 });
});
