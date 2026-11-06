import type { BillingModel } from "./plans";

// Pure paid-access rules from docs/internals/paid-access.md. Persistence and
// provider reads stay in billingState and polar; these functions only decide.

export type PlanChange = { model: "monthly" | "yearly"; at: number };

export type OrderRecord = {
  orderId: string;
  productId: string;
  subscriptionId?: string;
  paid: boolean;
  fullyRefunded: boolean;
  createdAt: number;
};

export type SubscriptionRecord = {
  subscriptionId: string;
  productId: string;
  status: string;
  periodStart: number;
  paidThrough: number;
  cancelAtPeriodEnd: boolean;
  modifiedAt: number;
  superseded: boolean;
  scheduledChange?: PlanChange;
  // Carries a 100% forever discount, which only the operator can create.
  comped?: boolean;
};

export type SubscriptionSnapshot = Omit<SubscriptionRecord, "superseded">;

export type Entitlement = {
  status: "awaiting_payment" | "active" | "ended";
  model?: BillingModel;
  subscriptionId?: string;
  lifetimeOrderId?: string;
  paidThrough?: number;
  cancelAtPeriodEnd: boolean;
  scheduledChange?: PlanChange;
};

export type EntitlementInput = {
  // The currently published entitlement.
  previous: Entitlement;
  // Stored order history, already merged with the provider snapshot.
  orders: OrderRecord[];
  // Stored subscription history before this snapshot.
  stored: SubscriptionRecord[];
  // Current provider subscriptions.
  snapshot: SubscriptionSnapshot[];
  // The owner has committed to account deletion.
  deleting: boolean;
  now: number;
  modelOf: (productId: string) => BillingModel | undefined;
};

export type EntitlementDecision = {
  entitlement: Entitlement;
  // New or changed subscription rows to persist.
  changed: SubscriptionRecord[];
  // Provider subscriptions that must be revoked.
  revoke: string[];
};

export const ended: Entitlement = { status: "ended", cancelAtPeriodEnd: false };

const revocable = ["active", "trialing", "past_due", "incomplete", "paused"];
const awaitingPayment = ["active", "trialing", "past_due", "incomplete"];
const hour = 60 * 60_000;
const day = 24 * hour;

export function computeEntitlement(input: EntitlementInput): EntitlementDecision {
  const { orders, deleting, modelOf } = input;
  const lifetime = latestLifetimeOrder(orders, modelOf);
  const history = new Map(input.stored.map((s) => [s.subscriptionId, s]));
  const changed: SubscriptionRecord[] = [];
  const revoke: string[] = [];

  for (const item of input.snapshot) {
    const old = history.get(item.subscriptionId);
    // A stale provider read never overwrites newer stored state.
    if (old && old.modifiedAt > item.modifiedAt) {
      continue;
    }
    // Unknown products are only tracked when they have to be revoked.
    if (!old && !modelOf(item.productId) && !lifetime && !deleting) {
      continue;
    }
    // Supersession is permanent: a lifetime purchase, deletion, or a full
    // refund of the current period means this subscription never grants again.
    const superseded = (old?.superseded ?? false) || !!lifetime || deleting ||
      refundsCurrentPeriod(item, orders);
    const record = { ...item, superseded };
    history.set(item.subscriptionId, record);
    if (!old || !sameValues(old, record)) {
      changed.push(record);
    }
    if (superseded && revocable.includes(item.status)) {
      revoke.push(item.subscriptionId);
    }
  }

  const entitlement = decide(input, lifetime, [...history.values()]);
  return { entitlement, changed, revoke };
}

function decide(input: EntitlementInput, lifetime: OrderRecord | undefined, subscriptions: SubscriptionRecord[]) {
  const { previous, orders, deleting } = input;
  if (deleting) {
    return ended;
  }
  if (lifetime) {
    return {
      status: "active",
      model: "lifetime",
      lifetimeOrderId: lifetime.orderId,
      cancelAtPeriodEnd: false,
    } satisfies Entitlement;
  }
  const recurring = currentRecurring(input, subscriptions);
  if (recurring) {
    const { subscription, model, paidThrough } = recurring;
    return {
      status: "active",
      model,
      subscriptionId: subscription.subscriptionId,
      paidThrough,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      scheduledChange: subscription.scheduledChange,
    } satisfies Entitlement;
  }
  const purchased = orders.some((o) => o.paid || o.fullyRefunded);
  if (previous.status !== "awaiting_payment" || purchased) {
    return ended;
  }
  return { status: "awaiting_payment", cancelAtPeriodEnd: false } satisfies Entitlement;
}

// Refunded lifetime orders lose their entitlement; another unrefunded
// lifetime purchase still grants access.
function latestLifetimeOrder(orders: OrderRecord[], modelOf: EntitlementInput["modelOf"]) {
  return orders
    .filter((o) => modelOf(o.productId) === "lifetime" && o.paid && !o.fullyRefunded)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

// Only a full refund of the current period revokes a subscription. Older
// period refunds and partial refunds don't remove a later paid period.
function refundsCurrentPeriod(subscription: SubscriptionSnapshot, orders: OrderRecord[]) {
  return orders.some((o) =>
    o.subscriptionId === subscription.subscriptionId && o.fullyRefunded && o.createdAt >= subscription.periodStart);
}

function currentRecurring(input: EntitlementInput, subscriptions: SubscriptionRecord[]) {
  const candidates = [];
  for (const subscription of subscriptions) {
    const model = input.modelOf(subscription.productId);
    if (!model || model === "lifetime" || subscription.superseded || subscription.status !== "active") {
      continue;
    }
    const paidThrough = confirmedPaidThrough(input, subscription);
    if (paidThrough > input.now) {
      candidates.push({ subscription, model, paidThrough });
    }
  }
  return candidates.sort((a, b) => b.subscription.modifiedAt - a.subscription.modifiedAt)[0];
}

// A paid, unrefunded order in the current period confirms the provider period.
// A zero-cost or prorated switch can move the period before a paid update
// arrives: keep already purchased time, but never extend it from an unpaid
// renewal or a provider period change alone. A comped subscription counts as
// paid through its whole provider period, since the comp covers every invoice.
function confirmedPaidThrough(input: EntitlementInput, subscription: SubscriptionRecord) {
  const paid = subscription.comped || input.orders.some((o) =>
    o.subscriptionId === subscription.subscriptionId && o.paid && !o.fullyRefunded &&
    o.createdAt >= subscription.periodStart);
  if (paid) {
    return subscription.paidThrough;
  }
  const { previous } = input;
  if (previous.status !== "active" || previous.subscriptionId !== subscription.subscriptionId ||
      previous.paidThrough === undefined) {
    return 0;
  }
  return Math.min(previous.paidThrough, subscription.paidThrough);
}

// An erased owner never regains access; every live subscription is revoked.
export function erasedEntitlement(snapshot: SubscriptionSnapshot[]) {
  const revoke = snapshot
    .filter((s) => s.status !== "canceled" && s.status !== "unpaid")
    .map((s) => s.subscriptionId);
  return { entitlement: ended, revoke };
}

// When the timed safety net should next re-read the provider after a
// successful reconciliation. Webhooks and user actions drive everything else.
export function nextScheduledCheck(entitlement: Entitlement, subscriptions: SubscriptionRecord[], now: number) {
  // Paid access can still end by refund or revocation. The expiry job
  // reconciles at paidThrough; this daily pass catches lost webhooks.
  if (entitlement.status === "active") {
    return now + day;
  }
  // A live subscription without paid time is waiting on a renewal or dunning
  // payment. Check hourly during the first day after payment became due.
  const due = subscriptions
    .filter((s) => !s.superseded && awaitingPayment.includes(s.status))
    .map((s) => (s.paidThrough > now ? s.periodStart : s.paidThrough));
  if (due.length === 0) {
    return undefined;
  }
  return now + (now - Math.max(...due) < day ? hour : day);
}

export function sameEntitlement(a: Entitlement, b: Entitlement) {
  return sameValues(entitlementOf(a), entitlementOf(b));
}

export function entitlementOf(account: Entitlement): Entitlement {
  return {
    status: account.status,
    model: account.model,
    subscriptionId: account.subscriptionId,
    lifetimeOrderId: account.lifetimeOrderId,
    paidThrough: account.paidThrough,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    scheduledChange: account.scheduledChange,
  };
}

// Compares every field of `next` with `stored`, including nested objects.
// Extra stored fields such as `_id` are ignored.
export function sameValues<T extends object>(stored: T, next: Partial<T>): boolean {
  return Object.entries(next).every(([key, value]) => sameValue(stored[key as keyof T], value));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => sameValue(a[key as keyof typeof a], b[key as keyof typeof b]));
  }
  return a === b;
}
