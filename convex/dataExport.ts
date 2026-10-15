import { parse } from "convex-helpers/validators";
import { paginationOptsValidator } from "convex/server";
import { v, type Value } from "convex/values";
import { appConfig } from "../app.config";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { accountLifecycleExport } from "./accountLifecycle";
import { billingExport } from "./billing";
import type { Exporter } from "./lib/dataExport";
import { appError } from "./lib/errors";
import { action, internalQuery } from "./lib/functions";
import { requireOwner } from "./lib/users";
import { legalExport } from "./legal";
import { profileExport } from "./profile";
import { withdrawalsExport } from "./withdrawals";

// Every section of the user's data export, one per feature. Registering a
// feature's exporter here adds it to the download; see docs/internals/data-export.md.
const exporters: Record<string, Exporter> = {
  profile: profileExport,
  billing: billingExport,
  accountLifecycle: accountLifecycleExport,
  legal: legalExport,
  withdrawals: withdrawalsExport,
};

// Bump when an exported shape changes incompatibly.
const formatVersion = 1;
// Each page is its own query, so a page must fit one transaction's read limit.
const pageOptions = { numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };
// Leaves headroom under Convex's 16 MiB function result limit.
const maxExportBytes = 12 * 1024 * 1024;

type PartPage = { items: Value[]; isDone: boolean; continueCursor: string };

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

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

// The caller's data as one JSON document. It travels as a string because
// Convex arrays hold at most 8192 values. Pages are separate reads, so the
// export is not a single point-in-time snapshot.
export const download = action({
  args: {},
  returns: v.string(),
  alwaysLog: true,
  handler: async (ctx) => {
    const ownerId: Id<"users"> = await ctx.runQuery(internal.dataExport.owner, {});
    ctx.log.setUser(ownerId);
    // A running total stops an oversized export before it exhausts action memory.
    let collected = 0;
    const sections: Record<string, Record<string, Value>> = {};
    for (const [section, exporter] of Object.entries(exporters)) {
      sections[section] = {};
      for (const [name, part] of Object.entries(exporter)) {
        const items: Value[] = [];
        let cursor: string | null = null;
        let done = false;
        while (!done) {
          const page: PartPage = await ctx.runQuery(internal.dataExport.readPart, {
            section, part: name, paginationOpts: { ...pageOptions, cursor },
          });
          items.push(...page.items);
          collected += jsonBytes(page.items);
          if (collected > maxExportBytes) {
            ctx.log.set("bytes", collected);
            throw appError("EXPORT_TOO_LARGE");
          }
          cursor = page.continueCursor;
          done = page.isDone;
        }
        sections[section][name] = part.kind === "one" ? items[0] ?? null : items;
        ctx.log.set(`${section}.${name}`, items.length);
      }
    }
    const json = JSON.stringify({ app: appConfig.appName, formatVersion, exportedAt: new Date().toISOString(), sections }, null, 2);
    const bytes = new TextEncoder().encode(json).length;
    ctx.log.set("bytes", bytes);
    if (bytes > maxExportBytes) throw appError("EXPORT_TOO_LARGE");
    return json;
  },
});
