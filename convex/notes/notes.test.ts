import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { legalVersions } from "../account/legalVersions";
import schema from "../schema";
import { modules } from "../test.setup";
import { noteLimits } from "./validation";

const issuer = "https://clerk.example";

// Tests move the clock with later(), so notes edited in sequence never tie on updatedAt.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

type Test = ReturnType<typeof convexTest>;

// A signed-in user with accepted terms and, unless `paid` is false, lifetime Pro.
async function user(t: Test, name: string, { paid = true } = {}) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      tokenIdentifier: `${issuer}|${name}`, clerkId: name, email: `${name}@example.com`, lifecycle: "active",
      profileUpdatedAt: 1, profileEventAt: 1, legalAcceptance: { ...legalVersions, acceptedAt: 1 },
    });
    if (paid) {
      await ctx.db.insert("billingAccounts", {
        customerId: `${name}-customer`, userId: id, status: "active", model: "lifetime", cancelAtPeriodEnd: false, revision: 1,
      });
    }
    return id;
  });
  return { userId, as: t.withIdentity({ issuer, subject: name }) };
}
const later = () => vi.advanceTimersByTime(1000);

const firstPage = { numItems: 10, cursor: null };
async function titles(caller: Awaited<ReturnType<typeof user>>["as"]) {
  const { page } = await caller.query(api.notes.notes.list, { paginationOpts: firstPage });
  return page.map((note) => note.title);
}

test("a Pro user creates, edits, lists, and deletes their notes", async () => {
  const t = convexTest(schema, modules);
  const alice = await user(t, "alice");
  const first = await alice.as.mutation(api.notes.notes.create, { title: "  First  ", body: " Body " });
  later();
  await alice.as.mutation(api.notes.notes.create, { title: "Second", body: "" });
  expect(await titles(alice.as)).toEqual(["Second", "First"]);
  expect(await alice.as.query(api.notes.notes.get, { noteId: first })).toMatchObject({ title: "First", body: "Body" });

  later();
  await alice.as.mutation(api.notes.notes.update, { noteId: first, title: "First, edited", body: "New body" });
  expect(await titles(alice.as)).toEqual(["First, edited", "Second"]);

  await alice.as.mutation(api.notes.notes.remove, { noteId: first });
  expect(await titles(alice.as)).toEqual(["Second"]);
  await expect(alice.as.query(api.notes.notes.get, { noteId: first })).rejects.toThrow("NOTE_NOT_FOUND");
});

test("another user can't read, update, pin, or delete a note by ID", async () => {
  const t = convexTest(schema, modules);
  const alice = await user(t, "alice");
  const bob = await user(t, "bob");
  // With pinning on, setPinned reaches the ownership check.
  await t.mutation(internal.featureFlags.setOverride, { key: "notePinning", enabled: true });
  const noteId = await alice.as.mutation(api.notes.notes.create, { title: "Private", body: "Alice only" });

  await expect(bob.as.query(api.notes.notes.get, { noteId })).rejects.toThrow("NOTE_NOT_FOUND");
  await expect(bob.as.mutation(api.notes.notes.update, { noteId, title: "Taken", body: "" })).rejects.toThrow("NOTE_NOT_FOUND");
  await expect(bob.as.mutation(api.notes.notes.setPinned, { noteId, pinned: true })).rejects.toThrow("NOTE_NOT_FOUND");
  await expect(bob.as.mutation(api.notes.notes.remove, { noteId })).rejects.toThrow("NOTE_NOT_FOUND");
  expect(await titles(bob.as)).toEqual([]);
  expect(await alice.as.query(api.notes.notes.get, { noteId })).toMatchObject({ title: "Private", body: "Alice only", pinned: false });
});

test("signed-in users without Pro are rejected with PAID_ACCESS_REQUIRED", async () => {
  const t = convexTest(schema, modules);
  const alice = await user(t, "alice", { paid: false });
  await expect(alice.as.query(api.notes.notes.list, { paginationOpts: firstPage })).rejects.toThrow("PAID_ACCESS_REQUIRED");
  await expect(alice.as.mutation(api.notes.notes.create, { title: "Note", body: "" })).rejects.toThrow("PAID_ACCESS_REQUIRED");
  await expect(t.query(api.notes.notes.list, { paginationOpts: firstPage })).rejects.toThrow("UNAUTHENTICATED");
});

test("titles and bodies are validated on the server", async () => {
  const t = convexTest(schema, modules);
  const alice = await user(t, "alice");
  const create = (title: string, body = "") => alice.as.mutation(api.notes.notes.create, { title, body });
  await expect(create("   ")).rejects.toThrow("INVALID_NOTE_TITLE");
  await expect(create("x".repeat(noteLimits.title + 1))).rejects.toThrow("INVALID_NOTE_TITLE");
  await expect(create("Title", "x".repeat(noteLimits.body + 1))).rejects.toThrow("INVALID_NOTE_BODY");
  const noteId = await create("x".repeat(noteLimits.title), "x".repeat(noteLimits.body));
  await expect(alice.as.mutation(api.notes.notes.update, { noteId, title: "", body: "" })).rejects.toThrow("INVALID_NOTE_TITLE");
});

test("pinning is unavailable until the flag is on, and pinned notes then sort first", async () => {
  const t = convexTest(schema, modules);
  const alice = await user(t, "alice");
  const older = await alice.as.mutation(api.notes.notes.create, { title: "Older", body: "" });
  later();
  await alice.as.mutation(api.notes.notes.create, { title: "Newer", body: "" });
  await expect(alice.as.mutation(api.notes.notes.setPinned, { noteId: older, pinned: true })).rejects.toThrow("FEATURE_UNAVAILABLE");

  await t.mutation(internal.featureFlags.allowUser, { key: "notePinning", userId: alice.userId });
  await alice.as.mutation(api.notes.notes.setPinned, { noteId: older, pinned: true });
  expect(await titles(alice.as)).toEqual(["Older", "Newer"]);

  // Turning the flag off restores the plain order without losing the pin.
  await t.mutation(internal.featureFlags.disallowUser, { key: "notePinning", userId: alice.userId });
  expect(await titles(alice.as)).toEqual(["Newer", "Older"]);
});

test("account erasure deletes all of the user's notes across batches", async () => {
  const t = convexTest(schema, modules);
  const alice = await user(t, "alice");
  const bob = await user(t, "bob");
  const lease = Date.now() + 60_000;
  const requestId = await t.run(async (ctx) => {
    for (let i = 0; i < 150; i++) {
      await ctx.db.insert("notes", { userId: alice.userId, title: `Note ${i}`, body: "", pinned: false, updatedAt: i });
    }
    await ctx.db.insert("notes", { userId: bob.userId, title: "Bob's", body: "", pinned: false, updatedAt: 1 });
    await ctx.db.patch("users", alice.userId, { lifecycle: "deletion_requested" });
    return ctx.db.insert("accountLifecycleRequests", {
      userId: alice.userId, source: "user", requestedAt: 1, status: "pending", leaseUntil: lease, erasing: true,
    });
  });
  const countNotes = (userId: Id<"users">) => t.run(async (ctx) =>
    (await ctx.db.query("notes").withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", userId)).collect()).length);

  expect(await t.mutation(internal.account.lifecycle.erase, { requestId, lease })).toBe(false);
  expect(await countNotes(alice.userId)).toBe(50);
  expect(await t.mutation(internal.account.lifecycle.erase, { requestId, lease })).toBe(true);
  expect(await countNotes(alice.userId)).toBe(0);
  expect(await countNotes(bob.userId)).toBe(1);
});
