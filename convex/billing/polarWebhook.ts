import { z } from "zod";
import { env } from "../_generated/server";
import { isWorktreeExternalId } from "./lib";

// SDK 1.x verifies signatures and recognizes event names, but doesn't validate
// resource fields at runtime. Normalize only the association we consume; all
// entitlement decisions use freshly fetched provider resources.
const metadata = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional();
const customer = z.object({ id: z.string().min(1), external_id: z.string().nullable().optional(), metadata });
const envelope = z.object({ type: z.string(), timestamp: z.iso.datetime({ offset: true }), data: z.unknown().optional() });
export function normalizePolarEvent(value: unknown) {
  const event = envelope.parse(value);
  let resource;
  if (event.type.startsWith("customer.") && !event.type.startsWith("customer_seat.")) {
    resource = customer.parse(event.data);
  } else if (["order.", "subscription.", "checkout.", "refund."].some(prefix => event.type.startsWith(prefix))) {
    const data = z.object({ id: z.string().min(1), customer_id: z.string().nullable().optional(),
      external_customer_id: z.string().nullable().optional(), customer: customer.nullable().optional(), metadata }).parse(event.data);
    if (data.customer && data.customer_id && data.customer.id !== data.customer_id) throw new Error("Customer association mismatch");
    const id = data.customer_id ?? data.customer?.id;
    // Incomplete checkout/refund associations cannot grant access. A later
    // customer event or owner reconciliation recovers the provider resources.
    if (!id) return { type: event.type, association: null };
    resource = { id, external_id: data.customer?.external_id ?? data.external_customer_id, metadata: data.customer?.metadata ?? data.metadata };
  } else return { type: event.type, association: null };
  const externalId = resource.external_id || undefined;
  const scoped = isWorktreeExternalId(externalId) || resource.metadata?.worktree_id === env.WORKTREE_ID;
  return { type: event.type, association: { customerId: resource.id, externalId, scoped } };
}
