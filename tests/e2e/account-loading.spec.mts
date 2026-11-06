import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

test("account cards reserve their space while loading at 1280px and 390px", async ({ page }) => {
  const user = await createClerkTestUser(local);

  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    const backend = await interceptConvexSync(page);

    const profile = page.locator('[data-slot="card"][aria-label="Profile"]');
    const dataExport = page.locator('[data-slot="card"][aria-label="Export your data"]');
    const deletion = page.locator('[data-slot="card"][aria-label="Account deletion"]');

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      backend.holdResponses();
      await page.reload();

      await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
      await expect(profile).toHaveAttribute("aria-busy", "true");
      await expect(dataExport).toHaveAttribute("aria-busy", "true");
      await expect(deletion).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "Save profile" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Export data" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Manage subscription" })).toHaveCount(0);
      await expect.poll(backend.pendingResponses).toBeGreaterThan(0);

      const profileBefore = await profile.boundingBox();
      const dataExportBefore = await dataExport.boundingBox();
      const deletionBefore = await deletion.boundingBox();
      await captureEvidence(page, `account-loading-${width}`);

      backend.releaseResponses();

      await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Export data" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
      await expect(profile).not.toHaveAttribute("aria-busy", "true");
      await expect(dataExport).not.toHaveAttribute("aria-busy", "true");
      await expect(deletion).not.toHaveAttribute("aria-busy", "true");

      const profileAfter = await profile.boundingBox();
      const dataExportAfter = await dataExport.boundingBox();
      const deletionAfter = await deletion.boundingBox();

      expect(profileBefore).not.toBeNull();
      expect(dataExportBefore).not.toBeNull();
      expect(deletionBefore).not.toBeNull();
      expect(profileAfter).not.toBeNull();
      expect(dataExportAfter).not.toBeNull();
      expect(deletionAfter).not.toBeNull();

      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(profileAfter![dimension]).toBeCloseTo(profileBefore![dimension], 0);
        expect(dataExportAfter![dimension]).toBeCloseTo(dataExportBefore![dimension], 0);
        expect(deletionAfter![dimension]).toBeCloseTo(deletionBefore![dimension], 0);
      }

      await captureEvidence(page, `account-loaded-${width}`);
    }
  } finally {
    await user.cleanup();
  }
});

test("stalled account skeletons offer recovery and resolve when responses arrive", async ({ page }) => {
  const user = await createClerkTestUser(local);

  try {
    // The fake clock runs the 15-second recovery timeout without waiting it out.
    // It must be installed before the page loads.
    await page.clock.install();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();

    const backend = await interceptConvexSync(page);
    backend.holdResponses();
    await page.reload();
    await expect(page.locator('[data-slot="card"][aria-busy="true"]')).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    // The server renders the skeletons too; their timeout starts once the page hydrates.
    await clerk.loaded({ page });
    // Well within the minute a Clerk session token lasts.
    await page.clock.fastForward(15_000);

    await expect(
      page.getByRole("alert").filter({ hasText: "We couldn’t load your account" }),
    ).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(3);
    await expect(page.locator('[data-slot="card"][aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);

    backend.releaseResponses();

    await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});
