import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { createClerkTestOrganization, createClerkTestUser as createUnpaidTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { resolveAuthenticatedDestination } from "../../lib/auth";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";

const local = resolveLocalTestConfig();
// The application page requires Pro, so these identity tests use paid users.
async function createClerkTestUser(config: typeof local) {
  const user = await createUnpaidTestUser(config);
  try { await seedPaidTestUser(user); return user; }
  catch (error) { await user.cleanup(); throw error; }
}
const authenticatedDestination = resolveAuthenticatedDestination(local.env.NEXT_PUBLIC_AUTHENTICATED_DESTINATION);
test("Clerk identity reaches paid local Convex and persists across reloads", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
    const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
    client.setAuth(token!);
    expect(await client.query(api.billing.account.application, {})).toEqual({ name: user.name });
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await clerk.signOut({ page });
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
  } finally { await user.cleanup(); }
});

test("sign-in fallback and return-to redirects reach the configured application destination", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: user.email });
    await expect(page).toHaveURL(`${local.config.env.APP_URL}${authenticatedDestination}`);
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await clerk.signOut({ page });
    await page.goto("/app?tab=profile");
    await clerk.signIn({ page, emailAddress: user.email });
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/app?tab=profile`);
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
  } finally {
    await user.cleanup();
  }
});

test("revoked sessions remove protected content and restored cookies cannot re-enter", async ({ page, browser }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    const savedSession = await page.context().storageState();
    await user.revokeSessions();
    // Force the same token refresh the SDK performs when its JWT expires.
    await page.evaluate(async () => {
      try { await window.Clerk.session?.getToken({ template: "convex", skipCache: true }); } catch { /* Revoked sessions cannot issue tokens. */ }
    });
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
    // Restore the original cookies in a fresh page so Clerk's live sign-out
    // redirect cannot race the attempt to re-enter the protected route.
    const restored = await browser.newContext({ baseURL: local.config.env.APP_URL, storageState: savedSession });
    try {
      const restoredPage = await restored.newPage();
      await restoredPage.goto("/app");
      await expect(restoredPage.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(restoredPage.getByRole("heading", { name: "Your application" })).toHaveCount(0);
      await expect(restoredPage.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    } finally { await restored.close(); }
  } finally {
    await user.cleanup();
  }
});

test("organization and role changes wait for fresh Convex validation", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let organization: Awaited<ReturnType<typeof createClerkTestOrganization>> | undefined;
  let release = () => {};
  try {
    organization = await createClerkTestOrganization(local, user.id);
    if (!organization) {
      test.skip(true, "The shared Clerk development instance has organizations disabled.");
      return;
    }
    // Hold JWT validation without logging tokens; other socket messages pass through.
    const sync = await interceptConvexSync(page);
    release = sync.releaseAuthentication;
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    sync.holdAuthentication();
    await page.evaluate(async (id) => { await window.Clerk.setActive({ organization: id }); }, organization.id);
    await expect(page.getByRole("status")).toHaveText("Connecting your account…");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();

    await organization.setRole("org:member");
    sync.holdAuthentication();
    await page.evaluate(async () => {
      await window.Clerk.organization?.reload();
      await window.Clerk.setActive({ organization: window.Clerk.organization?.id });
    });
    await expect(page.getByRole("status")).toHaveText("Connecting your account…");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
  } finally {
    release();
    await organization?.cleanup();
    await user.cleanup();
  }
});

test("signed-out application navigation preserves the requested destination and stays public at sign-in", async ({ page }) => {
  await page.goto("/app?tab=profile");
  await expect(page).toHaveURL((url) => url.origin === new URL(local.config.env.APP_URL).origin && url.pathname === "/sign-in");
  const returnTo = new URL(page.url()).searchParams.get("redirect_url");
  expect(returnTo).toBe(`${local.config.env.APP_URL}/app?tab=profile`);
  await clerk.loaded({ page });
  await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
  await page.goto("/sign-in?redirect_url=https%3A%2F%2Fevil.example%2Fapp");
  await expect(page).toHaveURL(`${local.config.env.APP_URL}/sign-in`);
});

test("separate users and account switching never keep the previous protected identity", async ({ page, browser }) => {
  const otherContext = await browser.newContext();
  const users: Awaited<ReturnType<typeof createClerkTestUser>>[] = [];
  try {
    const alice = await createClerkTestUser(local);
    users.push(alice);
    const bob = await createClerkTestUser(local);
    users.push(bob);
    const other = await otherContext.newPage();
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: alice.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toBeVisible();
    await other.goto(`${local.config.env.APP_URL}/`);
    await clerk.signIn({ page: other, emailAddress: bob.email });
    await other.goto(`${local.config.env.APP_URL}/app`);
    await expect(other.getByText(`Welcome ${bob.name}!`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toBeVisible();

    // The shared development instance allows one active session. Switch accounts
    // through sign-out/sign-in without reloading the page or query cache. Sign-out
    // leaves the protected route, so return to it through client-side navigation.
    const firstSession = await page.evaluate(() => window.Clerk.session?.id);
    await page.evaluate(() => { document.documentElement.dataset.accountSwitch = "same-document"; });
    await clerk.signOut({ page });
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toHaveCount(0);
    await clerk.signIn({ page, emailAddress: bob.email });
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByText(`Welcome ${bob.name}!`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.Clerk.session?.id)).not.toBe(firstSession);
    await clerk.signOut({ page });
    await clerk.signIn({ page, emailAddress: alice.email });
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Welcome ${bob.name}!`, { exact: true })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-account-switch", "same-document");
  } finally {
    await Promise.all(otherContext.pages().map((other) => other.unrouteAll({ behavior: "wait" })));
    await otherContext.close();
    await Promise.all(users.map((user) => user.cleanup()));
  }
});

test("slow Clerk token acquisition shows loading and sends no protected query", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const sync = await interceptConvexSync(page);
    await page.goto("/");
    await clerk.loaded({ page });
    await page.evaluate(() => {
      let blocked = true;
      let wrappedSession: string | undefined;
      const pending = new Set<() => void>();
      window.addEventListener("release-auth-test", () => {
        blocked = false;
        for (const resolve of pending) resolve();
      });
      window.Clerk.addListener(({ session }) => {
        if (!session || wrappedSession === session.id) return;
        wrappedSession = session.id;
        const getToken = session.getToken.bind(session);
        session.getToken = async (options) => {
          if (blocked) await new Promise<void>((resolve) => pending.add(resolve));
          return getToken(options);
        };
      });
    });
    await clerk.signIn({ page, emailAddress: user.email });
    // The landing page's signed-in pricing waits for Convex instead of showing guest plans.
    await expect(page.getByRole("status").filter({ hasText: "Loading paid plans…" })).toHaveText("Loading paid plans…");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
    expect(sync.hasSubscribed("billing/account:status")).toBe(false);
    expect(sync.hasSubscribed("billing/account:application")).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event("release-auth-test")));
    await expect(page.getByText("You have lifetime access.")).toBeVisible();
    expect(sync.hasSubscribed("billing/account:status")).toBe(true);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}${authenticatedDestination}`);
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    expect(sync.hasSubscribed("billing/account:application")).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event("release-auth-test")));
    await user.cleanup();
  }
});

test("a restored session waits for Convex validation without signed-out UI, redirects, or protected queries", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let release = () => {};
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    const sync = await interceptConvexSync(page);
    sync.holdAuthentication();
    release = sync.releaseAuthentication;
    await page.reload();
    await clerk.loaded({ page });
    await expect(page.getByRole("status").filter({ hasText: "Connecting your account…" })).toHaveText("Connecting your account…");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(`${local.config.env.APP_URL}/app`);
    expect(sync.hasSubscribed("billing/account:application")).toBe(false);
    release();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    expect(sync.hasSubscribed("billing/account:application")).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    release();
    await user.cleanup();
  }
});

test("stalled authentication has a recovery state instead of an endless loading screen", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    // Block authenticated Convex frames while retaining the restored Clerk cookie.
    (await interceptConvexSync(page)).holdAuthentication();
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t load your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(`${local.config.env.APP_URL}/app`);
  } finally {
    await user.cleanup();
  }
});
