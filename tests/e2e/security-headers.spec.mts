import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();

// Chrome logs every blocked load or eval as a console error naming the policy.
function watchViolations(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

test("pages, routes, and static files carry the security headers", async ({ request }) => {
  for (const path of ["/", "/terms", "/sign-in", "/app", "/does-not-exist"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain(new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).origin);
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"], path).toContain("camera=()");
    // Bootstrap runs next dev, which never sends HSTS.
    expect(headers["strict-transport-security"], path).toBeUndefined();
  }
  const icon = await request.get("/icon.svg");
  expect(icon.headers()["x-content-type-options"]).toBe("nosniff");
});

test("signing in, live data, and consented Sentry run without CSP violations", async ({ page }) => {
  const violations = watchViolations(page);
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    // Profile data arrives over Convex's WebSocket.
    await expect(page.getByLabel("Display name", { exact: true })).not.toHaveValue("");
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();

    await page.goto("/cookies");
    await page.getByRole("button", { name: "Cookie Preferences" }).click();
    const dialog = page.getByRole("dialog", { name: "Cookie Preferences" });
    await dialog.getByRole("switch", { name: "Analytics" }).click();
    await dialog.getByRole("button", { name: "Save preferences" }).click();
    // With consent stored, the next page load starts Sentry, which reports the load.
    const envelope = page.waitForRequest((request) => request.url().includes("/e2e/sentry/api/1/envelope"), { timeout: 30_000 });
    await page.goto("/");
    await envelope;
    expect(violations).toEqual([]);
  } finally {
    await user.cleanup();
  }
});
