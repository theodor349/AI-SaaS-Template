import { describe, expect, test } from "vitest";
import {
  computeEntitlement,
  erasedEntitlement,
  nextScheduledCheck,
  sameEntitlement,
  type Entitlement,
  type EntitlementInput,
  type OrderRecord,
  type SubscriptionRecord,
  type SubscriptionSnapshot,
} from "./entitlement";

const hour = 60 * 60_000;
const day = 24 * hour;
const now = 1_000 * day;
const periodStart = now - 10 * day;
const periodEnd = now + 20 * day;

const modelOf = (productId: string) => {
  if (productId === "monthly" || productId === "yearly" || productId === "lifetime") {
    return productId;
  }
  return undefined;
};

function subscription(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    subscriptionId: "sub-a",
    productId: "monthly",
    status: "active",
    periodStart,
    paidThrough: periodEnd,
    cancelAtPeriodEnd: false,
    modifiedAt: now - day,
    scheduledChange: undefined,
    ...overrides,
  };
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: "order-a",
    productId: "monthly",
    subscriptionId: "sub-a",
    paid: true,
    fullyRefunded: false,
    createdAt: periodStart + 1,
    ...overrides,
  };
}

const awaiting: Entitlement = { status: "awaiting_payment", cancelAtPeriodEnd: false };

function decide(input: Partial<EntitlementInput>) {
  return computeEntitlement({
    previous: awaiting,
    orders: [order()],
    stored: [],
    snapshot: [subscription()],
    deleting: false,
    now,
    modelOf,
    ...input,
  });
}

describe("recurring access", () => {
  test("a paid order in the current period grants access until the period ends", () => {
    expect(decide({}).entitlement).toEqual({
      status: "active",
      model: "monthly",
      subscriptionId: "sub-a",
      paidThrough: periodEnd,
      cancelAtPeriodEnd: false,
      scheduledChange: undefined,
    });
  });

  test("an unpaid renewal grants nothing, even when the provider advanced the period", () => {
    const renewal = subscription({ periodStart: now - hour, paidThrough: now + 30 * day });
    const previousPeriodOrder = order({ createdAt: periodStart });
    expect(decide({ snapshot: [renewal], orders: [previousPeriodOrder] }).entitlement.status).toBe("ended");
  });

  test("order creation and trialing subscriptions grant nothing", () => {
    expect(decide({ orders: [order({ paid: false })] }).entitlement.status).toBe("awaiting_payment");
    expect(decide({ snapshot: [subscription({ status: "trialing" })] }).entitlement.status).toBe("ended");
  });

  test("past due ends access without grace", () => {
    const decision = decide({ snapshot: [subscription({ status: "past_due" })] });
    expect(decision.entitlement.status).toBe("ended");
    expect(decision.revoke).toEqual([]);
  });

  test("cancellation keeps the paid period", () => {
    const decision = decide({ snapshot: [subscription({ cancelAtPeriodEnd: true })] });
    expect(decision.entitlement).toMatchObject({ status: "active", paidThrough: periodEnd, cancelAtPeriodEnd: true });
  });

  test("a scheduled plan change is published with the active subscription", () => {
    const scheduledChange = { model: "monthly" as const, at: periodEnd };
    const decision = decide({ snapshot: [subscription({ productId: "yearly", scheduledChange })] });
    expect(decision.entitlement).toMatchObject({ model: "yearly", scheduledChange });
  });
});

describe("prorated plan switches", () => {
  const previous: Entitlement = {
    status: "active",
    model: "monthly",
    subscriptionId: "sub-a",
    paidThrough: periodEnd,
    cancelAtPeriodEnd: false,
  };
  const switched = subscription({
    productId: "yearly",
    periodStart: now - hour,
    paidThrough: now + 365 * day,
    modifiedAt: now,
  });

  test("a switch without a paid update keeps already purchased time", () => {
    const zeroCost = order({ orderId: "zero", productId: "yearly", paid: false, createdAt: now - hour });
    const decision = decide({ previous, snapshot: [switched], orders: [order(), zeroCost] });
    expect(decision.entitlement).toMatchObject({ status: "active", model: "yearly", paidThrough: periodEnd });
  });

  test("a paid update confirms the new period", () => {
    const paid = order({ orderId: "paid", productId: "yearly", createdAt: now - hour + 1 });
    const decision = decide({ previous, snapshot: [switched], orders: [order(), paid] });
    expect(decision.entitlement.paidThrough).toBe(now + 365 * day);
  });

  test("preserved time never comes from a different subscription", () => {
    const other = { ...previous, subscriptionId: "sub-other" };
    const decision = decide({ previous: other, snapshot: [switched], orders: [] });
    expect(decision.entitlement.status).toBe("ended");
  });
});

describe("refunds", () => {
  test("a full refund of the current period ends access and revokes the subscription", () => {
    const decision = decide({ orders: [order({ fullyRefunded: true })] });
    expect(decision.entitlement.status).toBe("ended");
    expect(decision.revoke).toEqual(["sub-a"]);
    expect(decision.changed[0]).toMatchObject({ subscriptionId: "sub-a", superseded: true });
  });

  test("partial refunds keep access", () => {
    // A partial refund leaves the order paid and not fully refunded.
    const decision = decide({ orders: [order()] });
    expect(decision.entitlement.status).toBe("active");
    expect(decision.revoke).toEqual([]);
  });

  test("a previous-period refund does not remove a later paid period", () => {
    const refunded = order({ orderId: "old", fullyRefunded: true, createdAt: periodStart - 30 * day });
    const decision = decide({ orders: [refunded, order({ orderId: "renewal" })] });
    expect(decision.entitlement.status).toBe("active");
    expect(decision.revoke).toEqual([]);
  });

  test("a full lifetime refund removes only that order's entitlement", () => {
    const refunded = order({ orderId: "first", productId: "lifetime", subscriptionId: undefined, fullyRefunded: true });
    const second = order({ orderId: "second", productId: "lifetime", subscriptionId: undefined, createdAt: now - hour });
    expect(decide({ snapshot: [], orders: [refunded] }).entitlement.status).toBe("ended");
    expect(decide({ snapshot: [], orders: [refunded, second] }).entitlement)
      .toMatchObject({ status: "active", model: "lifetime", lifetimeOrderId: "second" });
  });
});

describe("lifetime purchases", () => {
  const lifetime = order({ orderId: "lifetime", productId: "lifetime", subscriptionId: undefined, createdAt: now - hour });

  test("lifetime supersedes and revokes recurring subscriptions", () => {
    const decision = decide({ orders: [order(), lifetime] });
    expect(decision.entitlement).toEqual({
      status: "active",
      model: "lifetime",
      lifetimeOrderId: "lifetime",
      cancelAtPeriodEnd: false,
    });
    expect(decision.revoke).toEqual(["sub-a"]);
    expect(decision.changed[0].superseded).toBe(true);
  });

  test("supersession survives a later lifetime refund", () => {
    const stored: SubscriptionRecord = { ...subscription(), superseded: true };
    const refunded = { ...lifetime, fullyRefunded: true };
    const decision = decide({ stored: [stored], orders: [order(), refunded], snapshot: [subscription({ modifiedAt: now })] });
    expect(decision.entitlement.status).toBe("ended");
  });

  test("a subscription for an unknown product is tracked only when it must be revoked", () => {
    const unknown = subscription({ subscriptionId: "sub-unknown", productId: "retired" });
    expect(decide({ snapshot: [unknown] }).changed).toEqual([]);
    expect(decide({ snapshot: [unknown], orders: [lifetime] }).revoke).toEqual(["sub-unknown"]);
  });
});

describe("account deletion", () => {
  test("a committed deletion grants nothing and revokes live subscriptions", () => {
    const decision = decide({ deleting: true });
    expect(decision.entitlement).toEqual({ status: "ended", cancelAtPeriodEnd: false });
    expect(decision.revoke).toEqual(["sub-a"]);
  });

  test("an erased owner revokes every subscription that is not already stopped", () => {
    const snapshot = [
      subscription(),
      subscription({ subscriptionId: "sub-canceled", status: "canceled" }),
      subscription({ subscriptionId: "sub-unpaid", status: "unpaid" }),
      subscription({ subscriptionId: "sub-expired", status: "incomplete_expired" }),
    ];
    expect(erasedEntitlement(snapshot)).toEqual({
      entitlement: { status: "ended", cancelAtPeriodEnd: false },
      revoke: ["sub-a", "sub-expired"],
    });
  });
});

describe("history merging", () => {
  test("an unchanged provider snapshot writes no subscription rows", () => {
    const first = decide({});
    const again = decide({ stored: first.changed, previous: first.entitlement });
    expect(again.changed).toEqual([]);
    expect(sameEntitlement(again.entitlement, first.entitlement)).toBe(true);
  });

  test("a stale provider read never overwrites newer stored state", () => {
    const stored: SubscriptionRecord = { ...subscription({ cancelAtPeriodEnd: true, modifiedAt: now }), superseded: false };
    const decision = decide({ stored: [stored], snapshot: [subscription({ modifiedAt: now - day })] });
    expect(decision.changed).toEqual([]);
    expect(decision.entitlement.cancelAtPeriodEnd).toBe(true);
  });

  test("ended access stays ended rather than returning to awaiting payment", () => {
    const ended: Entitlement = { status: "ended", cancelAtPeriodEnd: false };
    expect(decide({ previous: ended, snapshot: [], orders: [] }).entitlement.status).toBe("ended");
  });
});

describe("timed checks", () => {
  const stored = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord =>
    ({ ...subscription(), superseded: false, ...overrides });

  test("paid access gets a daily safety check", () => {
    expect(nextScheduledCheck({ status: "active", cancelAtPeriodEnd: false }, [stored()], now)).toBe(now + day);
  });

  test("accounts with nothing live wait for webhooks and user actions", () => {
    const awaitingAccount = { status: "awaiting_payment" as const, cancelAtPeriodEnd: false };
    const endedAccount = { status: "ended" as const, cancelAtPeriodEnd: false };
    expect(nextScheduledCheck(awaitingAccount, [], now)).toBeUndefined();
    expect(nextScheduledCheck(endedAccount, [stored({ status: "canceled" })], now)).toBeUndefined();
    expect(nextScheduledCheck(endedAccount, [stored({ superseded: true })], now)).toBeUndefined();
  });

  test("a due renewal is checked hourly for a day, then daily", () => {
    const endedAccount = { status: "ended" as const, cancelAtPeriodEnd: false };
    const lapsed = stored({ status: "past_due", paidThrough: now - hour });
    expect(nextScheduledCheck(endedAccount, [lapsed], now)).toBe(now + hour);
    const advanced = stored({ periodStart: now - 2 * hour, paidThrough: now + 30 * day });
    expect(nextScheduledCheck(endedAccount, [advanced], now)).toBe(now + hour);
    const longOverdue = stored({ status: "past_due", paidThrough: now - 3 * day });
    expect(nextScheduledCheck(endedAccount, [longOverdue], now)).toBe(now + day);
  });
});
