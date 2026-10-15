import type { BillingModel } from "./billingModel";
import type { OrderRecord } from "./entitlement";

// Pure rules for the 14-day right of withdrawal (forbrugeraftaleloven §20 a);
// see docs/internals/legal-documents.md.

export const legalTimeZone = "Europe/Copenhagen";
const withdrawalDays = 14;

export type Purchase = {
  // The purchase's first paid order, which identifies it.
  orderId: string;
  subscriptionId?: string;
  // The plan of the latest paid order, after any switch.
  model: BillingModel;
  purchasedAt: number;
  // The first moment withdrawal is no longer possible.
  withdrawUntil: number;
  // Paid orders that are not yet fully refunded.
  refundOrderIds: string[];
};

function danishTime(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: legalTimeZone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

// The period starts the day after the purchase and ends with the 14th day, in
// Danish time. Returns the midnight that ends it.
export function withdrawalDeadline(purchasedAt: number) {
  const { year, month, day } = danishTime(purchasedAt);
  const midnight = Date.UTC(year, month - 1, day + withdrawalDays + 1);
  // Danish clocks change at 01:00 UTC, never between UTC and Danish midnight.
  const local = danishTime(midnight);
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - midnight;
  return midnight - offset;
}

// The owner's purchases, oldest first. A lifetime order is one purchase; a
// subscription is one purchase from its first paid order, and its renewals and
// plan switches belong to it. Withdrawing refunds all of its paid orders.
export function purchases(orders: OrderRecord[], modelOf: (productId: string) => BillingModel | undefined): Purchase[] {
  const groups = new Map<string, OrderRecord[]>();
  const paid = orders.filter((o) => o.paid && modelOf(o.productId)).sort((a, b) => a.createdAt - b.createdAt);
  for (const order of paid) {
    const recurring = modelOf(order.productId) !== "lifetime" && order.subscriptionId;
    const key = recurring ? `subscription:${order.subscriptionId}` : `order:${order.orderId}`;
    groups.set(key, [...groups.get(key) ?? [], order]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const model = modelOf(group[group.length - 1].productId)!;
    return {
      orderId: first.orderId,
      subscriptionId: model === "lifetime" ? undefined : first.subscriptionId,
      model,
      purchasedAt: first.createdAt,
      withdrawUntil: withdrawalDeadline(first.createdAt),
      refundOrderIds: group.filter((o) => !o.fullyRefunded).map((o) => o.orderId),
    };
  });
}
