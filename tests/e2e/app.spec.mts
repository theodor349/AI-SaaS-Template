import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();

test("Clerk identity reaches local Convex and number mutations react and persist", async ({ page, context }) => {
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
    await expect(page.getByRole("button", { name: "Add a random number" })).toHaveCount(0);
    try {
      await clerk.signIn({ page, emailAddress: user.email });
    } catch {
      throw new Error("Official Clerk test sign-in failed. Check the development instance and local JWT configuration; tokens are omitted from this error.");
    }
    // This welcome value comes from ctx.auth.getUserIdentity(), not Clerk UI state.
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    expect([...sockets]).toEqual([new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).host]);

    const observer = await context.newPage();
    await observer.goto("/");
    await expect(observer.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL);
    const before = await client.query(api.myFunctions.listNumbers, { count: 10 });
    const value = ((before.numbers[0] ?? 0) + 1) % 10;
    await page.evaluate((nextValue) => { Math.random = () => (nextValue + 0.1) / 10; }, value);
    await page.getByRole("button", { name: "Add a random number" }).click();
    const expected = [value, ...before.numbers].slice(0, 10);
    const numbers = (target: typeof page) => target.locator("p").filter({ hasText: /^Numbers:/ });
    await expect(numbers(page)).toHaveText(`Numbers: ${expected.join(", ")}`);
    await expect(numbers(observer)).toHaveText(`Numbers: ${expected.join(", ")}`);
    expect((await client.query(api.myFunctions.listNumbers, { count: 10 })).numbers).toEqual(expected);
    await page.reload();
    await expect(numbers(page)).toHaveText(`Numbers: ${expected.join(", ")}`);
    try {
      await clerk.signOut({ page });
    } catch {
      throw new Error("Clerk test sign-out failed; session details are omitted.");
    }
    await expect(page.getByRole("button", { name: "Add a random number" })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
});
