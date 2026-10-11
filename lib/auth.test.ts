import { expect, test } from "vitest";
import { resolveAuthenticatedDestination, safeReturnTo } from "./auth";

test("the authenticated fallback defaults locally and rejects unsafe destinations", () => {
  expect(resolveAuthenticatedDestination(undefined)).toBe("/app");
  expect(resolveAuthenticatedDestination("/app/checkout?step=payment")).toBe("/app/checkout?step=payment");
  expect(resolveAuthenticatedDestination("/billing/recovery")).toBe("/billing/recovery");
  for (const value of ["https://evil.example/app", "//evil.example/app", "app", "/\\evil.example", "/sign-in?next=app", "/sign-up/welcome"]) {
    expect(() => resolveAuthenticatedDestination(value)).toThrow("NEXT_PUBLIC_AUTHENTICATED_DESTINATION");
  }
});

test("return-to preserves local destinations and rejects other origins and unsafe URLs", () => {
  const origin = "https://app.example.com";
  expect(safeReturnTo("/app?tab=profile#details", origin)).toBe("/app?tab=profile#details");
  expect(safeReturnTo(`${origin}/app?tab=profile`, origin)).toBe("/app?tab=profile");
  for (const value of ["https://evil.example/app", "//evil.example", "javascript:alert(1)", "/\\evil.example", "\n//evil.example", "http://app.example.com/app"]) {
    expect(safeReturnTo(value, origin)).toBeNull();
  }
});
