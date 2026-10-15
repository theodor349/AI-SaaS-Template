import { expect, test, type Page } from "@playwright/test";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();
const GRACE_MS = 2000;

declare global {
  interface Window { indicatorAppeared?: boolean }
}

const indicator = (page: Page) => page.getByRole("status").filter({ hasText: /Offline…|Reconnecting…/ });

// The landing page's plans come from a live Convex query, so they show once it connects.
async function openConnected(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Choose monthly" })).toBeVisible();
}

for (const width of [1280, 390]) {
  test(`going offline shows the indicator after a grace period and reconnecting hides it at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await openConnected(page);
    const heading = page.getByRole("heading", { name: "Your next idea starts here." });
    const before = await heading.boundingBox();

    const wentOffline = Date.now();
    await context.setOffline(true);
    await expect(indicator(page)).toHaveText("Offline…");
    expect(Date.now() - wentOffline).toBeGreaterThanOrEqual(GRACE_MS - 100);
    expect(await heading.boundingBox()).toEqual(before);
    const shown = (await indicator(page).locator("p").boundingBox())!;
    if (width < 768) {
      const bar = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
      expect(shown.y + shown.height).toBeLessThan(bar.y);
    }
    expect(shown.x + shown.width).toBeLessThanOrEqual(width);
    await captureEvidence(page, `offline-${width}`);

    await context.setOffline(false);
    await expect(indicator(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Back online" })).toHaveCount(1);
  });
}

test("a disconnect shorter than the grace period shows nothing", async ({ page, context }) => {
  await openConnected(page);
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (/Offline…|Reconnecting…/.test(document.body.innerText)) window.indicatorAppeared = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await context.setOffline(true);
  await page.waitForTimeout(GRACE_MS / 2);
  await context.setOffline(false);
  await page.waitForTimeout(GRACE_MS * 1.5);
  expect(await page.evaluate(() => window.indicatorAppeared)).toBeUndefined();
});

test("an unreachable backend shows reconnecting while the browser is online, and queries resume", async ({ page }) => {
  // Stands between the browser and this worktree's backend so the test can cut it off.
  const backendHost = new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).host;
  let reachable = true;
  const open = new Set<{ close: () => Promise<void> }>();
  const subscriptions: string[] = [];
  await page.routeWebSocket((url) => url.host === backendHost && url.pathname.endsWith("/sync"), (socket) => {
    if (!reachable) {
      void socket.close({ code: 1011, reason: "unreachable" });
      return;
    }
    const server = socket.connectToServer();
    open.add(socket);
    socket.onClose(() => open.delete(socket));
    socket.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as { type: string; modifications?: Array<{ type: string; udfPath?: string }> };
      for (const modification of frame.modifications ?? []) {
        if (frame.type === "ModifyQuerySet" && modification.type === "Add") subscriptions.push(modification.udfPath!);
      }
      server.send(message);
    });
  });
  await openConnected(page);
  const subscribedBefore = subscriptions.length;

  reachable = false;
  await Promise.all([...open].map((socket) => socket.close()));
  await expect(indicator(page)).toHaveText("Reconnecting…");

  reachable = true;
  await expect(indicator(page)).toHaveCount(0, { timeout: 60_000 });
  // The reconnected socket subscribes to the page's queries again.
  await expect.poll(() => subscriptions.length).toBeGreaterThan(subscribedBefore);
  expect(subscriptions.slice(subscribedBefore)).toEqual(expect.arrayContaining(subscriptions.slice(0, subscribedBefore)));
});
