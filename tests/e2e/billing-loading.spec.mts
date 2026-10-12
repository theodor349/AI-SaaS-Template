import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();
const catalog = (["monthly", "yearly", "lifetime"] as const).map((model) => ({
  model, name: model, amount: 2000, currency: "USD", taxBehavior: "provider",
}));

test.beforeAll(async () => {
  await clerkSetup({
    publishableKey: local.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: local.env.CLERK_SECRET_KEY,
    dotenv: false,
  });
});

// Keep real Clerk authentication and backend state. Substitute only display
// prices, so loading coverage does not depend on configured sandbox products.
async function holdBillingResponses(page: Page, mode: "all" | "catalog" = "all") {
  let holding = mode === "all";
  let released = false;
  const responses: Array<() => void> = [];
  const backendHost = new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).host;

  await page.routeWebSocket((url) => url.host === backendHost, (socket) => {
    const server = socket.connectToServer();
    const catalogQueries = new Set<number>();

    socket.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as {
        type: string;
        modifications?: Array<{ type: string; queryId: number; udfPath?: string }>;
      };
      if (frame.type === "ModifyQuerySet") {
        for (const modification of frame.modifications ?? []) {
          if (modification.type === "Add" && modification.udfPath === "billing:products") {
            catalogQueries.add(modification.queryId);
          } else if (modification.type === "Remove") {
            catalogQueries.delete(modification.queryId);
          }
        }
      }
      server.send(message);
    });

    server.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as {
        type: string;
        modifications?: Array<{ type: string; queryId: number; value?: unknown }>;
      };
      if (frame.type === "Transition") {
        for (const modification of frame.modifications ?? []) {
          if (modification.type === "QueryUpdated" && catalogQueries.has(modification.queryId)) {
            modification.value = catalog;
            if (!released && mode === "catalog") holding = true;
          }
        }
      }
      const send = () => socket.send(JSON.stringify(frame));
      if (holding) responses.push(send);
      else send();
    });
  });

  return {
    pendingCount: () => responses.length,
    release() {
      released = true;
      holding = false;
      responses.splice(0).forEach((send) => send());
    },
  };
}

for (const width of [1280, 390]) {
  test(`billing remains visible with safe pending controls at ${width}px`, async ({ page }) => {
    const user = await createClerkTestUser(local);
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await clerk.signIn({ page, emailAddress: user.email });
      await page.goto("/billing");
      await expect(page.getByRole("button", { name: "Choose yearly" })).toBeVisible();

      const backend = await holdBillingResponses(page);
      await page.reload();
      const status = page.locator('[data-slot="card"][aria-label="Billing status"]');
      const plans = page.locator('[aria-label="Paid plans"]');
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(1);
      await expect(status).toHaveAttribute("aria-busy", "true");
      await expect(plans).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "Check payment status" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Choose yearly" })).toHaveCount(0);
      await expect.poll(backend.pendingCount).toBeGreaterThan(0);
      const statusBefore = await status.boundingBox();
      const plansBefore = await plans.boundingBox();
      await page.screenshot({ path: `/tmp/billing-loading-${width}.png`, fullPage: true });
      backend.release();

      await expect(status).not.toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("button", { name: "Choose yearly" })).toBeEnabled();
      const statusAfter = await status.boundingBox();
      const plansAfter = await plans.boundingBox();
      expect(statusBefore).not.toBeNull();
      expect(statusAfter).not.toBeNull();
      expect(plansBefore).not.toBeNull();
      expect(plansAfter).not.toBeNull();
      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(statusAfter![dimension]).toBeCloseTo(statusBefore![dimension], 0);
        expect(plansAfter![dimension]).toBeCloseTo(plansBefore![dimension], 0);
      }
      await page.screenshot({ path: `/tmp/billing-loaded-${width}.png`, fullPage: true });
    } finally {
      await user.cleanup();
    }
  });
}

test("subscription controls remain usable while plan prices load independently", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await seedPaidTestUser(user, "monthly");
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    const backend = await holdBillingResponses(page, "catalog");
    await page.goto("/billing");
    await expect.poll(backend.pendingCount).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Customer portal" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Cancel subscription" })).toBeEnabled();
    await expect(page.locator('[aria-label="Plan prices"]')).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Switch to yearly" })).toHaveCount(0);
    backend.release();
    await expect(page.getByRole("button", { name: "Switch to yearly" })).toBeVisible();
  } finally {
    await user.cleanup();
  }
});

test("checkout disables duplicate attempts until the request fails, then permits retry", async ({ page }) => {
  const user = await createClerkTestUser(local);
  let release: (() => void) | undefined;
  let requests = 0;
  await page.routeWebSocket(/\/sync$/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => socket.send(message));
    socket.onMessage(async (message) => {
      const frame = JSON.parse(message.toString()) as { type: string; udfPath?: string; requestId: number };
      if (frame.type !== "Action" || frame.udfPath !== "polar:checkout") {
        server.send(message);
        return;
      }
      requests++;
      await new Promise<void>((resolve) => { release = resolve; });
      socket.send(JSON.stringify({
        type: "ActionResponse", requestId: frame.requestId,
        success: false, result: "Fixture checkout failure", logLines: [],
      }));
    });
  });
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/billing");
    const checkout = page.getByRole("button", { name: "Choose monthly" });
    await expect(checkout).toBeEnabled();
    const before = await checkout.boundingBox();
    await checkout.click();
    const pending = page.getByRole("button", { name: "Opening checkout…" });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveAttribute("aria-busy", "true");
    expect(await pending.boundingBox()).toEqual(before);
    await pending.dispatchEvent("click");
    expect(requests).toBe(1);
    release!();
    await expect(page.getByText("We couldn’t open checkout")).toBeVisible();
    await expect(checkout).toBeEnabled();
    await checkout.click();
    await expect(pending).toBeDisabled();
    await expect.poll(() => requests).toBe(2);
    release!();
    await expect(checkout).toBeEnabled();
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
    await user.cleanup();
  }
});
