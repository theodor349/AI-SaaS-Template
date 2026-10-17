import type { PaginationOptions, PaginationResult } from "convex/server";
import type { GenericValidator, Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "./functions";

// A feature's section of the user's data export, registered in
// convex/account/dataExport.ts. Each named part's `shape` is the documented export
// format: undeclared fields are stripped before export, so internal sync
// fields cannot leak by accident. Read only the owner's data.
export type Exporter = Record<string, ExportPart>;

export type ExportPart =
  | { kind: "one"; shape: GenericValidator; read: (ctx: QueryCtx, owner: Doc<"users">) => Promise<unknown> }
  | { kind: "many"; shape: GenericValidator;
    read: (ctx: QueryCtx, owner: Doc<"users">, paginationOpts: PaginationOptions) => Promise<PaginationResult<unknown>> };

// A single record, exported as an object or null.
export function exportOne<Shape extends GenericValidator>(
  shape: Shape,
  read: (ctx: QueryCtx, owner: Doc<"users">) => Promise<Infer<Shape> | null>,
): ExportPart {
  return { kind: "one", shape, read };
}

// A list read one page at a time, so the export stays within read limits
// however many rows the owner has. Pass `paginationOpts` to `.paginate()` as is.
export function exportMany<Shape extends GenericValidator>(
  shape: Shape,
  read: (ctx: QueryCtx, owner: Doc<"users">, paginationOpts: PaginationOptions) => Promise<PaginationResult<Infer<Shape>>>,
): ExportPart {
  return { kind: "many", shape, read };
}

export const noRows = { page: [], isDone: true, continueCursor: "" };

// Exported timestamps are ISO 8601 strings.
export function exportTime(timestamp: number): string;
export function exportTime(timestamp: number | undefined): string | null;
export function exportTime(timestamp: number | undefined) {
  return timestamp === undefined ? null : new Date(timestamp).toISOString();
}
