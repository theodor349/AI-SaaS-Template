import { expect, test } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent, scrubText } from "./scrub";

test("removes emails and credentials from text", () => {
  expect(scrubText("Could not invite ada.lovelace+test@example.co.uk")).toBe("Could not invite [email]");
  expect(scrubText("Authorization: Bearer abc.def-123")).toBe("Authorization: Bearer [token]");
  expect(scrubText("token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl here")).toBe("token [token] here");
  expect(scrubText("key sk_test_abc123 and whsec_c2VjcmV0")).toBe("key [secret] and [secret]");
  expect(scrubText("/sign-in?__clerk_db_jwt=dvb_123&redirect_url=%2Fapp")).toBe("/sign-in?__clerk_db_jwt=[redacted]&redirect_url=%2Fapp");
  expect(scrubText("/invite?email=ada%2Btest%40example.com&plan=pro")).toBe("/invite?email=[email]&plan=pro");
});

test("keeps package versions, trace IDs, and paths intact", () => {
  const text = "at node_modules/.pnpm/@sentry+nextjs@11.7.0_next@16.3.8/x.js and /_next/static/chunks/1n82_%40sentry_core_build_esm_0x388d2._.js and 0jwt_@scope_pkg._.js trace 0123456789abcdef0123456789abcdef";
  expect(scrubText(text)).toBe(text);
});

test("scrubs nested event fields and keeps only the user ID", () => {
  const event: ErrorEvent = {
    type: undefined,
    message: "Failed for a@b.io",
    exception: { values: [{ type: "Error", value: "Email a@b.io taken" }] },
    request: { url: "https://app.example/sign-in?ticket=secret" },
    user: { id: "user_123", email: "a@b.io", ip_address: "10.0.0.1", username: "ada" },
  };
  const scrubbed = scrubEvent(event);
  expect(JSON.stringify(scrubbed)).not.toContain("a@b.io");
  expect(scrubbed.request?.url).toBe("https://app.example/sign-in?ticket=[redacted]");
  expect(scrubbed.user).toEqual({ id: "user_123" });
  expect(scrubEvent({ type: undefined, user: { email: "a@b.io" } }).user).toBeUndefined();
});

test("scrubs breadcrumbs", () => {
  expect(scrubBreadcrumb({ category: "fetch", data: { url: "/api?token=abc" }, message: "a@b.io" }))
    .toEqual({ category: "fetch", data: { url: "/api?token=[redacted]" }, message: "[email]" });
});
