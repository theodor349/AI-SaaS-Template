import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { requireOwner } from "../lib/users";

// How long a generated export file, and so its URL, exists. The export card
// downloads it as soon as the action returns.
export const fileLifetime = 10 * 60_000;
const eraseBatch = 100;

// Records the caller's new export file, schedules its deletion, and returns
// its URL. The storage ID never leaves the server.
export const save = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.string(),
  handler: async (ctx, { storageId }) => {
    const owner = await requireOwner(ctx);
    const fileId = await ctx.db.insert("dataExportFiles", { userId: owner._id, storageId });
    await ctx.scheduler.runAfter(fileLifetime, internal.account.dataExportFiles.remove, { fileId });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Export file missing");
    return url;
  },
});

export const remove = internalMutation({
  args: { fileId: v.id("dataExportFiles") },
  returns: v.null(),
  handler: async (ctx, { fileId }) => {
    const file = await ctx.db.get("dataExportFiles", fileId);
    if (!file) return null;
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete("dataExportFiles", fileId);
    return null;
  },
});

// Deletes one batch of an erased account's export files. Returns false while
// more remain, so account erasure continues in a fresh transaction.
export async function eraseDataExportFiles(ctx: Pick<MutationCtx, "db" | "storage">, userId: Id<"users">) {
  const files = await ctx.db.query("dataExportFiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(eraseBatch);
  for (const file of files) {
    await ctx.storage.delete(file.storageId);
    await ctx.db.delete("dataExportFiles", file._id);
  }
  return files.length < eraseBatch;
}
