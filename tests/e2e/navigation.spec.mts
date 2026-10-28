import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { resolveAuthenticatedDestination } from "../../lib/auth";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();
const authenticatedDestination = resolveAuthenticatedDestination(local.env.NEXT_PUBLIC_AUTHENTICATED_DESTINATION);

test("profile navigation, public policies, and sign-out work at 1280px and 390px", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    const trigger = page.getByRole("button", { name: "Open profile menu" });
    const menu = page.getByRole("menu");
    const dialog = page.getByRole("dialog", { name: "Cookie Preferences" });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/account");
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(menu).toBeVisible();
      await expect(menu.getByText(user.email, { exact: true })).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      const bar = await page.getByRole("navigation", { name: "Main navigation" }).boundingBox();
      if (width < 768) expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(bar!.y);
      // Clicking outside must reach the input without restoring avatar focus.
      const displayName = page.getByLabel("Display name", { exact: true });
      await expect(displayName).toBeEnabled();
      await displayName.click();
      await expect(menu).toHaveCount(0);
      await expect(displayName).toBeFocused();
      await expect(trigger).not.toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await trigger.click();
      await page.getByRole("menuitem", { name: "Billing", exact: true }).click();
      await expect(page).toHaveURL(/\/billing$/);
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      // The menu's history entry gives way to the page it opened.
      await page.goBack();
      await expect(page).toHaveURL(/\/account$/);
      await trigger.click();
      await expect(menu).toBeVisible();
      await page.goBack();
      await expect(menu).toHaveCount(0);
      await expect(page).toHaveURL(/\/account$/);
      // An unpaid user can pass through the dashboard on the way to /billing, often
      // faster than toHaveURL polls, so wait for the navigation event instead.
      const dashboard = page.waitForURL(`${local.config.env.APP_URL}${authenticatedDestination}`);
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await dashboard;
      await page.goto("/billing");
      await trigger.click();
      await page.getByRole("menuitem", { name: "Cookie Preferences" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("switch", { name: "Essential" })).toBeChecked();
      await expect(dialog.getByRole("switch", { name: "Essential" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();

      for (const label of ["Privacy Policy", "Terms of Service", "Cookie Policy"]) {
        await trigger.click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      }
    }

    // Signing out ends the session, so it runs once, at the last width.
    await trigger.click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/`);
    await expect(trigger).toHaveCount(0);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, heading] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/cookies", "Cookie Policy"]]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        await expect(page.getByText(/^Effective \d{1,2} \w+ \d{4} · Version \d+$/)).toBeVisible();
      }
      const cookieButton = page.getByRole("button", { name: "Cookie Preferences" });
      await cookieButton.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
      await expect(cookieButton).toBeFocused();
    }
  } finally {
    await user.cleanup();
  }
});

test("failed Convex authentication keeps Dashboard reachable without exposing protected content", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.loaded({ page });
    await page.evaluate(() => {
      let wrappedSession: string | undefined;
      window.Clerk.addListener(({ session }) => {
        if (!session || wrappedSession === session.id) return;
        wrappedSession = session.id;
        const getToken = session.getToken.bind(session);
        session.getToken = async (options) => {
          if (options?.template === "convex") return null;
          return getToken(options);
        };
      });
    });
    await clerk.signIn({ page, emailAddress: user.email });
    const recovery = page.getByRole("alert").filter({ hasText: "We couldn’t load your account" });
    await expect(recovery).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}${authenticatedDestination}`);
    await expect(recovery).toBeVisible();
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});
