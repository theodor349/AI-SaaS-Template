import { expect, test } from "vitest";
import type { BillingModel } from "./billingModel";
import { purchases, withdrawalDeadline } from "./withdrawal";

const modelOf = (productId: string) => (["monthly", "yearly", "lifetime"] as BillingModel[]).find((m) => m === productId);

test.each([
  { case: "afternoon purchase across the October clock change", purchase: "2026-10-15T14:00:00Z", deadline: "2026-10-29T23:00:00Z" },
  { case: "purchase just before Danish midnight", purchase: "2026-10-15T21:59:59Z", deadline: "2026-10-29T23:00:00Z" },
  { case: "purchase just after Danish midnight", purchase: "2026-10-15T22:00:00Z", deadline: "2026-10-30T23:00:00Z" },
  { case: "purchase across the March clock change", purchase: "2026-03-20T12:00:00Z", deadline: "2026-04-03T22:00:00Z" },
])("the period ends at Danish midnight after the 14th day: $case", ({ purchase, deadline }) => {
  expect(new Date(withdrawalDeadline(Date.parse(purchase))).toISOString()).toBe(new Date(deadline).toISOString());
});

test("a subscription is one purchase from its first paid order; lifetime orders are their own", () => {
  const order = (orderId: string, productId: string, createdAt: number, extra: object = {}) =>
    ({ orderId, productId, createdAt, paid: true, fullyRefunded: false, ...extra });
  const result = purchases([
    order("switch", "yearly", 3, { subscriptionId: "sub" }),
    order("create", "monthly", 1, { subscriptionId: "sub" }),
    order("refunded", "monthly", 2, { subscriptionId: "sub", fullyRefunded: true }),
    order("unpaid", "monthly", 0, { subscriptionId: "sub", paid: false }),
    order("lifetime", "lifetime", 4),
    order("other-product", "unknown", 5),
  ], modelOf);

  expect(result).toEqual([
    { orderId: "create", subscriptionId: "sub", model: "yearly", purchasedAt: 1, withdrawUntil: withdrawalDeadline(1), refundOrderIds: ["create", "switch"] },
    { orderId: "lifetime", subscriptionId: undefined, model: "lifetime", purchasedAt: 4, withdrawUntil: withdrawalDeadline(4), refundOrderIds: ["lifetime"] },
  ]);
});
