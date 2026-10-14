/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { api, internal } from "./_generated/api";
import { hasErrorCode } from "./lib/errors";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://test.clerk.accounts.dev";
const secret = `whsec_${btoa("a sufficiently long test signing secret")}`;
// Distinctive personal data, so any leak into an event is detectable.
const fixture = { clerkId: "user_fixtureClerkId", email: "fixture.person@example.com", firstName: "Fixturefirst", lastName: "Fixturelast" };
const personalData = [fixture.clerkId, fixture.email, fixture.firstName, fixture.lastName, `${issuer}|${fixture.clerkId}`];

type Event = { flowId: string; userId?: string; status: "success" | "error"; error?: { code?: string; stack?: string };
  path: { decision: string }[]; attributes: Record<string, unknown> };
let logs: MockInstance<typeof console.log>;
let errors: MockInstance<typeof console.error>;
const lines = () => [...logs.mock.calls, ...errors.mock.calls].map(([line]) => String(line));
const events = () => lines().map(line => JSON.parse(line) as Event);
function clearEvents() {
  logs.mockClear();
  errors.mockClear();
}

beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", secret);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "");
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|${fixture.clerkId}`, clerkId: fixture.clerkId, email: fixture.email,
    displayName: `${fixture.firstName} ${fixture.lastName}`, lifecycle: "active", profileUpdatedAt: 1, profileEventAt: 1,
  }));
  clearEvents();
  return { t, userId, user: t.withIdentity({ issuer, subject: fixture.clerkId, name: fixture.firstName, email: fixture.email }) };
}

test("a mutation emits one success event, or one error event that keeps the client's error code", async () => {
  const { user, userId } = await setup();
  await user.mutation(api.profile.save, { displayName: "New name" });
  expect(errors).not.toHaveBeenCalled();
  expect(events()).toEqual([expect.objectContaining({ status: "success", userId })]);

  clearEvents();
  const failure: unknown = await user.mutation(api.profile.save, { displayName: "\u0000" }).catch((error: unknown) => error);
  expect(hasErrorCode(failure, "INVALID_NAME")).toBe(true);
  expect(logs).not.toHaveBeenCalled();
  const [event] = events();
  expect(events()).toHaveLength(1);
  expect(event).toMatchObject({ status: "error", userId, error: { code: "INVALID_NAME" } });
  expect(event.error?.stack).toContain("INVALID_NAME");
});

test("query successes are logged only when their sample rate allows it", async () => {
  const { user } = await setup();
  await user.query(api.users.current, {});
  expect(events()).toEqual([]);

  vi.stubEnv("LOG_SAMPLE_RATE_QUERY", "1");
  await user.query(api.users.current, {});
  expect(events()).toEqual([expect.objectContaining({ status: "success" })]);

  vi.stubEnv("LOG_SAMPLE_RATE_QUERY", "");
  await expect(convexTest(schema, modules).query(api.users.current, {})).rejects.toThrow("UNAUTHENTICATED");
  expect(events().at(-1)).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
});

test("a browser flow continues through the work its mutation schedules", async () => {
  vi.useFakeTimers();
  const { t, user, userId } = await setup();
  const flow = { flowId: "client-generated-flow" };
  await user.mutation(api.accountLifecycle.requestDeletion, { flow });
  expect(events()).toEqual([expect.objectContaining({ flowId: flow.flowId, userId })]);

  clearEvents();
  vi.runAllTimers();
  await t.finishInProgressScheduledFunctions();
  // The scheduled processor, the mutations it runs, and the billing cleanup
  // action it calls all log in the same flow.
  expect(events().length).toBeGreaterThan(2);
  expect(new Set(events().map(event => event.flowId))).toEqual(new Set([flow.flowId]));
});

test("events carry no personal data, and webhook deliveries log one event per attempt", async () => {
  const { t, user } = await setup();
  vi.stubEnv("LOG_SAMPLE_RATE_QUERY", "1");
  const profile = { id: fixture.clerkId, updated_at: 100, primary_email_address_id: "email_a",
    email_addresses: [{ id: "email_a", email_address: fixture.email }], first_name: fixture.firstName, last_name: fixture.lastName };
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(profile))
    .mockResolvedValueOnce(Response.json({ ...profile, id: "user_someoneElse" }));

  await user.query(api.users.current, {});
  await user.mutation(api.profile.save, { displayName: `${fixture.firstName} ${fixture.lastName}` });
  await user.action(api.users.ensureCurrentUser, { refresh: true });
  await expect(user.action(api.users.ensureCurrentUser, { refresh: true })).rejects.toThrow("PROVISIONING_FAILED");
  await t.mutation(internal.users.syncProfile, { profile: { ...fixture, updatedAt: 200 }, eventAt: 200 });

  const payload = JSON.stringify({ type: "user.updated", timestamp: 300, data: { ...profile, updated_at: 300 } });
  const date = new Date();
  const headers = { "svix-id": "msg_fixture", "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign("msg_fixture", date, payload) };
  expect((await t.fetch("/webhooks/clerk", { method: "POST", body: payload, headers })).status).toBe(200);
  expect((await t.fetch("/webhooks/clerk", { method: "POST", body: payload, headers })).status).toBe(200);

  const deliveries = events().filter(event => event.attributes.responseStatus !== undefined);
  expect(deliveries).toHaveLength(2);
  expect(deliveries.map(event => event.attributes.deliveryId)).toEqual(["msg_fixture", "msg_fixture"]);
  expect(new Set(deliveries.map(event => event.flowId)).size).toBe(2);

  const output = lines().join("\n");
  for (const value of personalData) expect(output).not.toContain(value);
});
