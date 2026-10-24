import type { BillingModel } from "./plans";
import type { OrderRecord } from "./entitlement";

// Pure rules for the 14-day right of withdrawal (forbrugeraftaleloven §20 a);
// see docs/internals/legal-documents.md.

export const legalTimeZone = "Europe/Copenhagen";
const withdrawalDays = 14;
const dayMs = 24 * 60 * 60_000;

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
  // None of those orders charged money, so there is nothing to refund.
  nothingCharged: boolean;
};

function danishTime(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: legalTimeZone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

// Danish Easter Sunday, by the anonymous Gregorian algorithm, as a UTC date.
function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return Date.UTC(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

// §19, stk. 6: a period ending on a Saturday, a public holiday (including
// Sundays), Constitution Day, Christmas Eve, or New Year's Eve runs on to the
// next working day. `date` is a UTC midnight standing for a Danish calendar day.
function extendsPeriod(date: number) {
  const day = new Date(date);
  if (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    return true;
  }
  const fixed = ["1-1", "6-5", "12-24", "12-25", "12-26", "12-31"];
  if (fixed.includes(`${day.getUTCMonth() + 1}-${day.getUTCDate()}`)) {
    return true;
  }
  // Maundy Thursday, Good Friday, Easter Monday, Ascension Day, and Whit Monday.
  const fromEaster = Math.round((date - easterSunday(day.getUTCFullYear())) / dayMs);
  return [-3, -2, 1, 39, 50].includes(fromEaster);
}

// The period starts the day after the purchase and ends with the 14th day, in
// Danish time, extended past days the law excludes. Returns the midnight that ends it.
export function withdrawalDeadline(purchasedAt: number) {
  const { year, month, day } = danishTime(purchasedAt);
  let lastDay = Date.UTC(year, month - 1, day + withdrawalDays);
  while (extendsPeriod(lastDay)) {
    lastDay += dayMs;
  }
  const midnight = lastDay + dayMs;
  // Danish clocks change at 01:00 UTC, never between UTC and Danish midnight.
  const local = danishTime(midnight);
  const offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - midnight;
  return midnight - offset;
}

// The owner's purchases, oldest first. A lifetime order is one purchase; a
// subscription is one purchase from its first paid order, and its renewals and
// plan switches belong to it. Withdrawing refunds all of its paid orders.
// `nothingCharged` is absent on orders stored before it was recorded, which were all charged.
type StoredOrder = OrderRecord & { nothingCharged?: boolean };

export function purchases(orders: StoredOrder[], modelOf: (productId: string) => BillingModel | undefined): Purchase[] {
  const groups = new Map<string, StoredOrder[]>();
  const paid = orders.filter((o) => o.paid && modelOf(o.productId)).sort((a, b) => a.createdAt - b.createdAt);
  for (const order of paid) {
    const recurring = modelOf(order.productId) !== "lifetime" && order.subscriptionId;
    const key = recurring ? `subscription:${order.subscriptionId}` : `order:${order.orderId}`;
    groups.set(key, [...groups.get(key) ?? [], order]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const model = modelOf(group[group.length - 1].productId)!;
    const refundable = group.filter((o) => !o.fullyRefunded);
    return {
      orderId: first.orderId,
      subscriptionId: model === "lifetime" ? undefined : first.subscriptionId,
      model,
      purchasedAt: first.createdAt,
      withdrawUntil: withdrawalDeadline(first.createdAt),
      refundOrderIds: refundable.map((o) => o.orderId),
      nothingCharged: refundable.every((o) => o.nothingCharged === true),
    };
  });
}
