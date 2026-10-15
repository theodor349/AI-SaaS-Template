import { expect, test } from "vitest";
import type { BillingModel } from "./billingModel";
import { purchases, withdrawalDeadline } from "./withdrawal";

const modelOf = (productId: string) => (["monthly", "yearly", "lifetime"] as BillingModel[]).find((m) => m === productId);

test.each([
  { case: "afternoon purchase across the October clock change", purchase: "2026-10-15T14:00:00Z", deadline: "2026-10-29T23:00:00Z" },
  { case: "purchase just before Danish midnight", purchase: "2026-10-15T21:59:59Z", deadline: "2026-10-29T23:00:00Z" },
  { case: "purchase just after Danish midnight", purchase: "2026-10-15T22:00:00Z", deadline: "2026-10-30T23:00:00Z" },
  { case: "purchase across the March clock change", purchase: "2026-03-16T12:00:00Z", deadline: "2026-03-30T22:00:00Z" },
])("the period ends at Danish midnight after the 14th day: $case", ({ purchase, deadline }) => {
  expect(new Date(withdrawalDeadline(Date.parse(purchase))).toISOString()).toBe(new Date(deadline).toISOString());
});

test.each([
  { case: "a Saturday runs on past Sunday", purchase: "2026-10-17T12:00:00Z", deadline: "2026-11-02T23:00:00Z" },
  { case: "Good Friday runs on past Easter", purchase: "2026-03-20T12:00:00Z", deadline: "2026-04-07T22:00:00Z" },
  { case: "Christmas Eve runs on past Christmas", purchase: "2026-12-10T12:00:00Z", deadline: "2026-12-28T23:00:00Z" },
  { case: "Constitution Day", purchase: "2026-05-22T12:00:00Z", deadline: "2026-06-08T22:00:00Z" },
  { case: "Whit Monday", purchase: "2026-05-11T12:00:00Z", deadline: "2026-05-26T22:00:00Z" },
])("a period ending on a day §19(6) excludes ends with the next working day: $case", ({ purchase, deadline }) => {
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
