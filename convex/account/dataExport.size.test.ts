import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { exportMany } from "../lib/dataExport";
import schema from "../schema";
import { modules } from "../test.setup";

// About twice the largest export expected from an app moving onto the
// template: 90,000 rows and over 20 MiB of JSON.
const rows = 90_000;
const text = "x".repeat(220);

// convex-test scans a whole table for each page, so this test-only exporter
// generates its rows from the cursor instead of reading 90,000 documents.
// It replaces the notes section, the only list the seeded user would have.
vi.mock("../notes/notes", async (importOriginal) => ({
  ...await importOriginal<typeof import("../notes/notes")>(),
  notesExport: {
    rows: exportMany(v.object({ index: v.number(), text: v.string() }), async (_ctx, _owner, { cursor, numItems }) => {
      const start = Number(cursor ?? 0);
      const end = Math.min(start + numItems, rows);
      const page = Array.from({ length: end - start }, (_, offset) => ({ index: start + offset, text }));
      return { page, isDone: end === rows, continueCursor: String(end) };
    }),
  },
}));

const issuer = "https://clerk.example";

beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("an export of 90,000 rows and over 20 MiB is stored as one file", { timeout: 60_000 }, async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", {
    tokenIdentifier: `${issuer}|alice-clerk`, clerkId: "alice-clerk", email: "alice@example.com",
    profileUpdatedAt: 0, profileEventAt: 0, lifecycle: "active",
  }));

  const url = await t.withIdentity({ issuer, subject: "alice-clerk" }).action(api.account.dataExport.download, {});

  const stored = await t.run(async (ctx) => {
    const [file] = await ctx.db.query("dataExportFiles").withIndex("by_userId", (q) => q.eq("userId", userId)).collect();
    return { url: await ctx.storage.getUrl(file.storageId), text: await (await ctx.storage.get(file.storageId))!.text() };
  });
  expect(stored.url).toBe(url);
  expect(new TextEncoder().encode(stored.text).length).toBeGreaterThan(20 * 1024 * 1024);
  const exported = JSON.parse(stored.text) as { sections: { notes: { rows: { index: number }[] } } };
  expect(exported.sections.notes.rows).toHaveLength(rows);
  expect(exported.sections.notes.rows.every((row, index) => row.index === index)).toBe(true);
});
