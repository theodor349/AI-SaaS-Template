import { parse } from "convex-helpers/validators";
import { paginationOptsValidator } from "convex/server";
import { v, type Value } from "convex/values";
import { appConfig } from "../../app.config";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { accountLifecycleExport } from "./lifecycle";
import { billingExport } from "../billing/account";
import type { Exporter } from "../lib/dataExport";
import { appError } from "../lib/errors";
import { action, internalQuery, type ActionCtx } from "../lib/functions";
import { requireOwner } from "../lib/users";
import { profileExport } from "./profile";
import { withdrawalsExport } from "../billing/withdrawals";
import { notesExport } from "../notes/notes";

// Every section of the user's data export, one per feature. Registering a
// feature's exporter here adds it to the download; see docs/internals/data-export.md.
const exporters: Record<string, Exporter> = {
  profile: profileExport,
  billing: billingExport,
  accountLifecycle: accountLifecycleExport,
  withdrawals: withdrawalsExport,
  notes: notesExport,
};

// Bump when an exported shape changes incompatibly.
const formatVersion = 2;
// Each page is its own query, so a page must fit one transaction's read limit.
const pageOptions = { numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };
// The action holds the whole encoded file before storing it. On a local
// backend a 57 MiB file fit the default runtime's 64 MiB of action memory and
// a 95 MiB file did not, so this keeps room for a page of rows and the runtime.
const maxExportBytes = 32 * 1024 * 1024;

type PartPage = { items: Value[]; isDone: boolean; continueCursor: string };

function findPart(section: string, part: string) {
  const exporter = Object.hasOwn(exporters, section) ? exporters[section] : undefined;
  const found = exporter && Object.hasOwn(exporter, part) ? exporter[part] : undefined;
  if (!found) throw new Error("Unknown export part");
  return found;
}

export const owner = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => (await requireOwner(ctx))._id,
});

// One page of one export part. The owner comes from the caller's identity.
export const readPart = internalQuery({
  args: { section: v.string(), part: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { section, part: name, paginationOpts }): Promise<PartPage> => {
    const owner = await requireOwner(ctx);
    const part = findPart(section, name);
    if (part.kind === "one") {
      const value = await part.read(ctx, owner);
      return { items: value === null ? [] : [parse(part.shape, value)], isDone: true, continueCursor: "" };
    }
    const result = await part.read(ctx, owner, paginationOpts);
    return { items: result.page.map((item) => parse(part.shape, item)), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

// The caller's export as compact JSON text, one piece per page, so the whole
// export never exists as a single string. Logs each part's row count.
async function* exportJson(ctx: ActionCtx): AsyncGenerator<string> {
  const header = { app: appConfig.appName, formatVersion, exportedAt: new Date().toISOString() };
  yield `${JSON.stringify(header).slice(0, -1)},"sections":{`;
  for (const [sectionIndex, [section, exporter]] of Object.entries(exporters).entries()) {
    yield `${sectionIndex ? "," : ""}${JSON.stringify(section)}:{`;
    for (const [partIndex, [name, part]] of Object.entries(exporter).entries()) {
      yield `${partIndex ? "," : ""}${JSON.stringify(name)}:`;
      if (part.kind === "many") yield "[";
      let count = 0;
      let cursor: string | null = null;
      let done = false;
      while (!done) {
        const page: PartPage = await ctx.runQuery(internal.account.dataExport.readPart, {
          section, part: name, paginationOpts: { ...pageOptions, cursor },
        });
        if (part.kind === "one") {
          yield JSON.stringify(page.items[0] ?? null);
        } else if (page.items.length) {
          // A page's items without their brackets, continuing the part's array.
          yield `${count ? "," : ""}${JSON.stringify(page.items).slice(1, -1)}`;
        }
        count += page.items.length;
        cursor = page.continueCursor;
        done = page.isDone;
      }
      if (part.kind === "many") yield "]";
      ctx.log.set(`${section}.${name}`, count);
    }
    yield "}";
  }
  yield "}}";
}

// Writes the caller's data to a JSON file in Convex storage and returns its
// URL, which works until the file is deleted a few minutes later. Pages are
// separate reads, so the export is not a single point-in-time snapshot.
export const download = action({
  args: {},
  returns: v.string(),
  alwaysLog: true,
  handler: async (ctx) => {
    const ownerId: Id<"users"> = await ctx.runQuery(internal.account.dataExport.owner, {});
    ctx.log.setUser(ownerId);
    await ctx.runMutation(internal.rateLimits.admit, { action: "dataExport" });
    const encoder = new TextEncoder();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    // A running total stops an oversized export before it exhausts action memory.
    let bytes = 0;
    for await (const text of exportJson(ctx)) {
      const chunk = encoder.encode(text);
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes > maxExportBytes) {
        ctx.log.set("bytes", bytes);
        throw appError("EXPORT_TOO_LARGE");
      }
    }
    ctx.log.set("bytes", bytes);
    const storageId = await ctx.storage.store(new Blob(chunks, { type: "application/json" }));
    try {
      const url: string = await ctx.runMutation(internal.account.dataExportFiles.save, { storageId });
      return url;
    } catch (error) {
      // Nobody has this file's URL yet, so it can go now.
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});
