import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();

test.beforeAll(async () => {
  await clerkSetup({
    publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: local.env.CLERK_SECRET_KEY,
    dotenv: false,
  });
});

async function holdBackendResponses(page: Page) {
  let holdingResponses = true;
  const responses: Array<() => void> = [];
  const backendHost = new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).host;

  await page.routeWebSocket((url) => url.host === backendHost, (socket) => {
    const server = socket.connectToServer();

    server.onMessage((message) => {
      if (holdingResponses) {
        responses.push(() => socket.send(message));
      } else {
        socket.send(message);
      }
    });
  });

  return {
    pendingResponseCount: () => responses.length,
    hold() {
      holdingResponses = true;
    },
    release() {
      holdingResponses = false;
      responses.splice(0).forEach((send) => send());
    },
  };
}

for (const width of [1280, 390]) {
  test(`account cards reserve their space while loading at ${width}px`, async ({ page }) => {
    const user = await createClerkTestUser(local);

    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await clerk.signIn({ page, emailAddress: user.email });
      await page.goto("/account");
      await expect(page.getByLabel("First name", { exact: true })).toBeVisible();

      const backend = await holdBackendResponses(page);
      await page.reload();

      const profile = page.locator('[data-slot="card"][aria-label="Profile"]');
      const deletion = page.locator('[data-slot="card"][aria-label="Account deletion"]');

      await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
      await expect(profile).toHaveAttribute("aria-busy", "true");
      await expect(deletion).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "Save profile" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Manage subscription" })).toHaveCount(0);
      await expect.poll(backend.pendingResponseCount).toBeGreaterThan(0);

      const profileBefore = await profile.boundingBox();
      const deletionBefore = await deletion.boundingBox();
      await page.screenshot({ path: `/tmp/account-loading-${width}.png`, fullPage: true });

      backend.release();

      await expect(page.getByLabel("First name", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
      await expect(profile).not.toHaveAttribute("aria-busy", "true");
      await expect(deletion).not.toHaveAttribute("aria-busy", "true");

      const profileAfter = await profile.boundingBox();
      const deletionAfter = await deletion.boundingBox();

      expect(profileBefore).not.toBeNull();
      expect(deletionBefore).not.toBeNull();
      expect(profileAfter).not.toBeNull();
      expect(deletionAfter).not.toBeNull();

      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(profileAfter![dimension]).toBeCloseTo(profileBefore![dimension], 0);
        expect(deletionAfter![dimension]).toBeCloseTo(deletionBefore![dimension], 0);
      }

      await page.screenshot({ path: `/tmp/account-loaded-${width}.png`, fullPage: true });
    } finally {
      await user.cleanup();
    }
  });
}

test("stalled account skeletons offer recovery and resolve when responses arrive", async ({ page }) => {
  const user = await createClerkTestUser(local);

  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await expect(page.getByLabel("First name", { exact: true })).toBeVisible();

    const backend = await holdBackendResponses(page);
    await page.reload();
    await expect(page.locator('[data-slot="card"][aria-busy="true"]')).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);

    await expect(
      page.getByRole("alert").filter({ hasText: "We couldn’t load your account" }),
    ).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(2);
    await expect(page.locator('[data-slot="card"][aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0);

    backend.release();

    await expect(page.getByLabel("First name", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});

test("profile saving uses the button state and persists changes while email stays disabled", async ({ page }) => {
  const user = await createClerkTestUser(local);

  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");
    await expect(page.getByLabel("First name", { exact: true })).toBeVisible();

    const backend = await holdBackendResponses(page);
    await page.reload();
    await expect(page.locator('[data-slot="card"][aria-busy="true"]')).toHaveCount(2);
    backend.release();

    const lastName = page.getByLabel("Last name", { exact: true });
    const email = page.getByLabel("Email", { exact: true });

    await expect(email).toHaveValue(user.email);
    await expect(email).toBeDisabled();
    await lastName.fill("  Saved surname  ");

    backend.hold();
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();

    backend.release();
    await expect(page.getByRole("button", { name: "Save profile" })).toBeEnabled();
    await expect(lastName).toHaveValue("Saved surname");

    await page.reload();
    await expect(lastName).toHaveValue("Saved surname");
    await expect(email).toHaveValue(user.email);
    await expect(email).toBeDisabled();
  } finally {
    await user.cleanup();
  }
});
