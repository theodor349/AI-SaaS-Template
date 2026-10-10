import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { createClerkTestOrganization, createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { resolveAuthenticatedDestination } from "../../lib/auth";

const local = resolveLocalTestConfig();
const authenticatedDestination = resolveAuthenticatedDestination(local.env.NEXT_PUBLIC_AUTHENTICATED_DESTINATION);

// Hold JWT validation without logging tokens; query frames reveal whether the
// protected consumer subscribed too early. Other socket messages pass through.
async function controlConvexAuthentication(page: Page, initiallyBlocked = true) {
  let blocked = initiallyBlocked;
  let protectedQuerySent = false;
  const pending = new Set<() => void>();
  await page.routeWebSocket(/\/sync$/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => socket.send(message));
    socket.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as {
        type: string;
        tokenType?: string;
        modifications?: { udfPath?: string }[];
      };
      if (frame.modifications?.some((modification) => modification.udfPath === "auth:currentIdentity")) protectedQuerySent = true;
      if (blocked && frame.type === "Authenticate" && frame.tokenType !== "None") pending.add(() => server.send(message));
      else server.send(message);
    });
  });
  return {
    block: () => { blocked = true; },
    release: () => {
      blocked = false;
      for (const send of pending) send();
      pending.clear();
    },
    hasProtectedQuery: () => protectedQuerySent,
  };
}

test.beforeAll(async () => {
  try {
    await clerkSetup({
      publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: local.env.CLERK_SECRET_KEY,
      dotenv: false,
    });
  } catch {
    throw new Error("Clerk testing-token setup failed. Check the worktree's development credentials; provider error details are omitted.");
  }
});

test("Clerk identity reaches local Convex and number mutations react and persist", async ({ page, context }) => {
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
    await page.getByRole("link", { name: "Open application" }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}${authenticatedDestination}`);
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    // Verify claims without returning or recording the JWT itself.
    const claims = await page.evaluate(async () => {
      const token = await window.Clerk.session?.getToken({ template: "convex", skipCache: true });
      if (!token) throw new Error("No Convex token was acquired");
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { iss: string; aud: string | string[] };
      return { issuer: payload.iss, audience: payload.aud };
    });
    expect(claims.issuer).toBe(local.env.CLERK_JWT_ISSUER_DOMAIN);
    expect([claims.audience].flat()).toContain("convex");
    try {
      await clerk.signOut({ page });
    } catch {
      throw new Error("Clerk test sign-out failed; session details are omitted.");
    }
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a random number" })).toHaveCount(0);
  } finally {
    await user.cleanup();
  }
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

test("revoked sessions remove protected content and restored cookies cannot re-enter", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    await user.revokeSessions();
    // Force the same token refresh the SDK performs when its JWT expires.
    await page.evaluate(async () => {
      try { await window.Clerk.session?.getToken({ template: "convex", skipCache: true }); } catch { /* Revoked sessions cannot issue tokens. */ }
    });
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your application" })).toHaveCount(0);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\?/);
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
    const auth = await controlConvexAuthentication(page, false);
    release = auth.release;
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    auth.block();
    await page.evaluate(async (id) => { await window.Clerk.setActive({ organization: id }); }, organization.id);
    await expect(page.getByRole("status")).toHaveText("Connecting your account…");
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();

    await organization.setRole("org:member");
    auth.block();
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
  await expect(page).toHaveURL(/\/sign-in\?/);
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
    // through sign-out/sign-in without reloading the page or query cache.
    const firstSession = await page.evaluate(() => window.Clerk.session?.id);
    await clerk.signOut({ page });
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toHaveCount(0);
    await clerk.signIn({ page, emailAddress: bob.email });
    await expect(page.getByText(`Welcome ${bob.name}!`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.Clerk.session?.id)).not.toBe(firstSession);
    await clerk.signOut({ page });
    await clerk.signIn({ page, emailAddress: alice.email });
    await expect(page.getByText(`Welcome ${alice.name}!`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Welcome ${bob.name}!`, { exact: true })).toHaveCount(0);
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
    const auth = await controlConvexAuthentication(page, false);
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
    await expect(page.getByRole("status")).toHaveText("Connecting your account…");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open application" })).toHaveCount(0);
    expect(auth.hasProtectedQuery()).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event("release-auth-test")));
    await expect(page.getByRole("link", { name: "Open application" })).toBeVisible();
    await page.getByRole("link", { name: "Open application" }).click();
    await expect(page).toHaveURL(`${local.config.env.APP_URL}${authenticatedDestination}`);
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    expect(auth.hasProtectedQuery()).toBe(true);
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
    const auth = await controlConvexAuthentication(page);
    release = auth.release;
    await page.reload();
    await clerk.loaded({ page });
    await expect(page.getByRole("status")).toHaveText("Connecting your account…");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(`${local.config.env.APP_URL}/app`);
    expect(auth.hasProtectedQuery()).toBe(false);
    release();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toBeVisible();
    expect(auth.hasProtectedQuery()).toBe(true);
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
    await controlConvexAuthentication(page);
    await page.reload();
    await expect(page.getByRole("alert").filter({ hasText: "We couldn’t load your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page.getByText(`Welcome ${user.name}!`, { exact: true })).toHaveCount(0);
    expect(page.url()).toBe(`${local.config.env.APP_URL}/app`);
  } finally {
    await user.cleanup();
  }
});
