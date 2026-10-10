import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();

test("Clerk sign-in authenticates with local Convex and survives reload", async ({ page, context }) => {
  try {
    await clerkSetup({
      publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: local.env.CLERK_SECRET_KEY,
      dotenv: false,
    });
  } catch {
    throw new Error("Clerk testing-token setup failed. Check the worktree's development credentials; provider error details are omitted.");
  }
  const user = await createClerkTestUser(local);
  try {
    const sockets = new Set<string>();
    page.on("websocket", (socket) => {
      const url = new URL(socket.url());
      if (url.pathname.endsWith("/sync")) sockets.add(url.host);
    });
    await page.goto("/");
    await clerk.loaded({ page });
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    try {
      await clerk.signIn({ page, emailAddress: user.email });
    } catch {
      throw new Error("Official Clerk test sign-in failed. Check the development instance and local JWT configuration; tokens are omitted from this error.");
    }
    // Authenticated content waits for Convex to accept the Clerk token.
    await expect(page.getByText("You’re signed in.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    expect([...sockets]).toEqual([new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).host]);

    const observer = await context.newPage();
    await observer.goto("/");
    await expect(observer.getByText("You’re signed in.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("You’re signed in.", { exact: true })).toBeVisible();
    try {
      await clerk.signOut({ page });
    } catch {
      throw new Error("Clerk test sign-out failed; session details are omitted.");
    }
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByText("You’re signed in.", { exact: true })).toHaveCount(0);
    await expect(observer.getByText("You’re signed in.", { exact: true })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});
