import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePro } from "../billing/lib";
import { exportMany, exportTime } from "../lib/dataExport";
import { appError } from "../lib/errors";
import { isFlagEnabled, requireFlag } from "../lib/featureFlags";
import { mutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import schema from "../schema";
import { noteFields } from "./validation";

// Notes is the template's reference paid feature: every function requires
// Pro and reads only the caller's notes. Rename it into your first feature or
// remove it with the add-feature skill's steps.

const note = schema.doc("notes");

// The caller's note. Another user's note is NOTE_NOT_FOUND too, so a guessed ID
// reveals nothing about whether it exists.
async function ownNote(ctx: Pick<QueryCtx, "db" | "log">, userId: Id<"users">, noteId: Id<"notes">) {
  ctx.log.set("noteId", noteId);
  const found = await ctx.db.get("notes", noteId);
  if (!found || found.userId !== userId) throw appError("NOTE_NOT_FOUND");
  return found;
}

// Most recently edited first. While notePinning is on, pinned notes come first.
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(note),
  handler: async (ctx, { paginationOpts }) => {
    const user = await requirePro(ctx);
    const notes = await isFlagEnabled(ctx, "notePinning")
      ? ctx.db.query("notes").withIndex("by_userId_and_pinned_and_updatedAt", (q) => q.eq("userId", user._id))
      : ctx.db.query("notes").withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", user._id));
    return notes.order("desc").paginate(paginationOpts);
  },
});

export const get = query({
  args: { noteId: v.id("notes") },
  returns: note,
  handler: async (ctx, { noteId }) => {
    const user = await requirePro(ctx);
    return ownNote(ctx, user._id, noteId);
  },
});

export const create = mutation({
  args: { title: v.string(), body: v.string() },
  returns: v.id("notes"),
  handler: async (ctx, { title, body }) => {
    const user = await requirePro(ctx, Date.now());
    const noteId = await ctx.db.insert("notes", {
      userId: user._id, ...noteFields(title, body), pinned: false, updatedAt: Date.now(),
    });
    ctx.log.set("noteId", noteId);
    return noteId;
  },
});

export const update = mutation({
  args: { noteId: v.id("notes"), title: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { noteId, title, body }) => {
    const user = await requirePro(ctx, Date.now());
    await ownNote(ctx, user._id, noteId);
    await ctx.db.patch("notes", noteId, { ...noteFields(title, body), updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, { noteId }) => {
    const user = await requirePro(ctx, Date.now());
    await ownNote(ctx, user._id, noteId);
    await ctx.db.delete("notes", noteId);
    return null;
  },
});

// Behind the notePinning flag. Hiding the pin button doesn't stop a direct call.
export const setPinned = mutation({
  args: { noteId: v.id("notes"), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { noteId, pinned }) => {
    const user = await requirePro(ctx, Date.now());
    await requireFlag(ctx, "notePinning");
    await ownNote(ctx, user._id, noteId);
    await ctx.db.patch("notes", noteId, { pinned });
    return null;
  },
});

const eraseBatch = 100;

// Deletes one batch of an erased account's notes. Returns false while more
// remain, so account erasure continues in a fresh transaction.
export async function eraseNotes(ctx: Pick<MutationCtx, "db">, userId: Id<"users">) {
  const notes = await ctx.db.query("notes")
    .withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", userId))
    .take(eraseBatch);
  for (const { _id } of notes) await ctx.db.delete("notes", _id);
  return notes.length < eraseBatch;
}

// Data export section, registered in account/dataExport.ts.
export const notesExport = {
  notes: exportMany(
    v.object({ title: v.string(), body: v.string(), pinned: v.boolean(), createdAt: v.string(), updatedAt: v.string() }),
    async (ctx, owner, paginationOpts) => {
      const result = await ctx.db.query("notes")
        .withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", owner._id))
        .paginate(paginationOpts);
      return { ...result, page: result.page.map((row) => ({
        title: row.title, body: row.body, pinned: row.pinned,
        createdAt: exportTime(row._creationTime), updatedAt: exportTime(row.updatedAt),
      })) };
    },
  ),
};
