/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
async function paidTest(name?: string, subject = "paid-test") {
  const base = convexTest(schema, modules);
  await base.run(async ctx => {
    const userId = await ctx.db.insert("users", { tokenIdentifier: `issuer|${subject}`, clerkId: subject,
      email: "test@example.com", lifecycle: "active", profileUpdatedAt: 0, profileEventAt: 0 });
    await ctx.db.insert("billingAccounts", { userId, customerId: subject, status: "active", model: "lifetime",
      cancelAtPeriodEnd: false, revision: 1, reconciledAt: 1, nextCheckAt: 1, requestedVersion: 1,
      completedVersion: 1, leaseUntil: 0, attempts: 0 });
  });
  return base.withIdentity({ tokenIdentifier: `issuer|${subject}`, subject, ...(name ? { name } : {}) });
}

test("a paid account sees an empty database without a name claim", async () => {
  const t = await paidTest();
  expect(await t.query(api.myFunctions.listNumbers, { count: 10 })).toEqual({
    viewer: null,
    numbers: [],
  });
});

test("mutations persist numbers and queries respect the requested limit", async () => {
  const t = await paidTest();
  for (const value of [42, -3, 0]) {
    await t.mutation(api.myFunctions.addNumber, { value });
  }
  const all = await t.query(api.myFunctions.listNumbers, { count: 10 });
  expect(all.numbers).toHaveLength(3);
  expect(all.numbers).toEqual(expect.arrayContaining([42, -3, 0]));
  expect((await t.query(api.myFunctions.listNumbers, { count: 2 })).numbers)
    .toHaveLength(2);
  expect((await t.query(api.myFunctions.listNumbers, { count: 0 })).numbers)
    .toEqual([]);
});

test("viewer comes from the paid caller identity and remains null without a name claim", async () => {
  const t = await paidTest();
  const asAlice = await paidTest("Alice", "alice");
  const asBob = await paidTest("Bob", "bob");
  const unnamed = await paidTest(undefined, "unnamed");
  expect((await asAlice.query(api.myFunctions.listNumbers, { count: 10 })).viewer)
    .toBe("Alice");
  expect((await asBob.query(api.myFunctions.listNumbers, { count: 10 })).viewer)
    .toBe("Bob");
  expect((await unnamed.query(api.myFunctions.listNumbers, { count: 10 })).viewer)
    .toBeNull();
  expect((await t.query(api.myFunctions.listNumbers, { count: 10 })).viewer)
    .toBeNull();
});

test("the action writes through its nested mutation", async () => {
  const t = await paidTest();
  await t.action(api.myFunctions.myAction, { first: 7, second: "example" });
  expect((await t.query(api.myFunctions.listNumbers, { count: 10 })).numbers)
    .toEqual([7]);
});

test("invalid function arguments and stored values are rejected", async () => {
  const t = await paidTest();
  const invalidNumber = "invalid" as unknown as number;
  await expect(t.mutation(api.myFunctions.addNumber, { value: invalidNumber }))
    .rejects.toThrow();
  await expect(t.query(api.myFunctions.listNumbers, { count: invalidNumber }))
    .rejects.toThrow();
  await expect(t.run(async (ctx) => {
    await ctx.db.insert("numbers", { value: invalidNumber });
  })).rejects.toThrow();
  expect((await t.query(api.myFunctions.listNumbers, { count: 10 })).numbers)
    .toEqual([]);
});

test("separate test instances cannot read each other's database", async () => {
  const a = await paidTest();
  const b = await paidTest();
  await a.mutation(api.myFunctions.addNumber, { value: 101 });
  await b.mutation(api.myFunctions.addNumber, { value: 202 });
  expect((await a.query(api.myFunctions.listNumbers, { count: 10 })).numbers)
    .toEqual([101]);
  expect((await b.query(api.myFunctions.listNumbers, { count: 10 })).numbers)
    .toEqual([202]);
});
