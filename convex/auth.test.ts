/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("protected queries reject anonymous callers", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.auth.currentIdentity, {})).rejects.toThrow("UNAUTHENTICATED");
});

test("identity comes from the caller, including issuer, without a provisioned user record", async () => {
  const t = convexTest(schema, modules);
  for (const [issuer, name] of [["https://development.clerk.accounts.dev", "Alice"], ["https://clerk.example.com", "Bob"]]) {
    const tokenIdentifier = `${issuer}|same-subject`;
    const user = t.withIdentity({ subject: "same-subject", issuer, tokenIdentifier, name });
    expect(await user.query(api.auth.currentIdentity, {})).toEqual({ tokenIdentifier, name });
  }
  const unnamed = t.withIdentity({ subject: "unnamed", tokenIdentifier: "issuer|unnamed" });
  expect(await unnamed.query(api.auth.currentIdentity, {})).toEqual({ tokenIdentifier: "issuer|unnamed", name: null });
});

test("clients cannot select another caller's identity through arguments", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ name: "Alice", subject: "alice" });
  const forged = { userId: "bob" } as unknown as Record<string, never>;
  await expect(alice.query(api.auth.currentIdentity, forged)).rejects.toThrow();
});
