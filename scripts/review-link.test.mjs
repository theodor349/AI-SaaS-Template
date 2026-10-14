import assert from "node:assert/strict";
import test from "node:test";
import { reviewLink, reviewLinkOptions } from "./review-link.mjs";

const app = "https://agent.example.ts.net:12345";

test("review links carry the ticket and an absolute same-origin destination", () => {
  const link = new URL(reviewLink(app, "ticket-value", "/billing?plan=yearly"));
  assert.equal(`${link.origin}${link.pathname}`, `${app}/sign-in`);
  assert.equal(link.searchParams.get("__clerk_ticket"), "ticket-value");
  assert.equal(link.searchParams.get("redirect_url"), `${app}/billing?plan=yearly`);
  assert.equal(new URL(reviewLink(app, "ticket-value", null)).searchParams.has("redirect_url"), false);
  for (const path of ["https://evil.example/", "//evil.example", "/sign-in", "/sign-up/verify", "billing"]) {
    assert.throws(() => reviewLink(app, "ticket-value", path), /application path|sign-in or sign-up/, path);
  }
  assert.doesNotThrow(() => reviewLink(app, "ticket-value", "/sign-insights"));
});

test("review link options bound the credential lifetime by the sweep retention", () => {
  assert.deepEqual(reviewLinkOptions([]), { plan: null, path: null, expiresMs: 3_600_000 });
  assert.deepEqual(reviewLinkOptions(["--plan", "lifetime", "--path", "/billing", "--expires", "2d"]),
    { plan: "lifetime", path: "/billing", expiresMs: 172_800_000 });
  for (const expires of ["30s", "8d", "1"]) assert.throws(() => reviewLinkOptions(["--expires", expires]), /--expires/);
  assert.throws(() => reviewLinkOptions(["--plan", "weekly"]), /--plan/);
});
