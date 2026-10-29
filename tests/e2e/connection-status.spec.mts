import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appConfig } from "../../app.config";
import { seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();
const GRACE_MS = 2000;

declare global {
  interface Window { indicatorAppeared?: boolean }
}

const indicator = (page: Page) => page.getByRole("status").filter({ hasText: /Offline…|Reconnecting…/ });

let visitor: Awaited<ReturnType<typeof createClerkTestUser>> | undefined;
test.afterEach(async () => {
  await visitor?.cleanup();
  visitor = undefined;
});

// Opens the landing page once live Convex data has arrived. Its plans come from a
// query; an app without billing has none, so a signed-in visitor's name stands in.
async function openConnected(page: Page) {
  await page.goto("/");
  if (appConfig.billing) {
    await expect(page.getByRole("link", { name: "Choose monthly" })).toBeVisible();
    return;
  }
  visitor = await createClerkTestUser(local);
  await seedPaidTestUser(visitor);
  await clerk.signIn({ page, emailAddress: visitor.email });
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await expect(page.getByRole("menu").getByText(visitor.name, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
}

test("going offline shows the indicator after a grace period and reconnecting hides it at 1280px and 390px", async ({ page, context }) => {
  await openConnected(page);
  const heading = page.getByRole("heading", { name: `${appConfig.tagline}.` });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
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
  }
});

test("the indicator shows and is announced above an open dialog at 1280px and 390px", async ({ page, context }) => {
  await page.goto("/cookies");
  await page.getByRole("button", { name: "Cookie Preferences" }).click();
  await expect(page.getByRole("dialog", { name: "Cookie Preferences" })).toBeVisible();
  // Hit testing skips elements with `pointer-events: none`, so let the indicator take
  // hits to find out what is drawn on top at its center.
  await page.addStyleTag({ content: "[role=status] p { pointer-events: auto !important; }" });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await context.setOffline(true);
    const shown = page.getByText("Offline…");
    await expect(shown).toBeVisible();
    await captureEvidence(page, `offline-dialog-${width}`);

    const box = (await shown.boundingBox())!;
    const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[role=status]"),
      [box.x + box.width / 2, box.y + box.height / 2]);
    expect(onTop).toBe(true);

    // The modal dialog hides the rest of the page from assistive technology; the
    // indicator must stay in the accessibility tree to be announced.
    await expect(indicator(page)).toHaveText("Offline…");
    await context.setOffline(false);
    await expect(indicator(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Back online" })).toHaveCount(1);
  }
});

test("a disconnect shorter than the grace period shows nothing", async ({ page, context }) => {
  // The fake clock runs the grace period without waiting it out.
  await page.clock.install();
  await openConnected(page);
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (/Offline…|Reconnecting…/.test(document.body.innerText)) window.indicatorAppeared = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  // Advance the clock only once the page has seen each change.
  const online = () => page.evaluate(() => navigator.onLine);
  await context.setOffline(true);
  await expect.poll(online).toBe(false);
  await page.clock.runFor(GRACE_MS / 2);
  await context.setOffline(false);
  await expect.poll(online).toBe(true);
  await page.clock.runFor(GRACE_MS * 1.5);
  expect(await page.evaluate(() => window.indicatorAppeared)).toBeUndefined();
});

test("an unreachable backend shows reconnecting while the browser is online, and queries resume", async ({ page }) => {
  // Stands between the browser and this worktree's backend so the test can cut it off.
  const backendHost = new URL(local.config.env.NEXT_PUBLIC_CONVEX_URL).host;
  let reachable = true;
  const open = new Set<{ close: () => Promise<void> }>();
  const subscribed = new Set<string>();
  // Paths of the query results the backend delivered, in order.
  const results: string[] = [];
  await page.routeWebSocket((url) => url.host === backendHost && url.pathname.endsWith("/sync"), (socket) => {
    if (!reachable) {
      void socket.close({ code: 1011, reason: "unreachable" });
      return;
    }
    const server = socket.connectToServer();
    // Query IDs are per connection; a reconnect starts a new query set.
    const queryPaths = new Map<number, string>();
    open.add(socket);
    // With a close handler, Playwright no longer forwards the closure to the backend.
    socket.onClose(() => {
      open.delete(socket);
      void server.close();
    });
    socket.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as { type: string; modifications?: Array<{ type: string; queryId: number; udfPath?: string }> };
      for (const modification of frame.type === "ModifyQuerySet" ? frame.modifications ?? [] : []) {
        if (modification.type !== "Add") continue;
        queryPaths.set(modification.queryId, modification.udfPath!);
        subscribed.add(modification.udfPath!);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as { type: string; modifications?: Array<{ type: string; queryId: number }> };
      for (const modification of frame.type === "Transition" ? frame.modifications ?? [] : []) {
        if (modification.type === "QueryUpdated") results.push(queryPaths.get(modification.queryId)!);
      }
      socket.send(message);
    });
  });
  await openConnected(page);
  const pagePaths = [...subscribed];
  expect(pagePaths).not.toHaveLength(0);

  reachable = false;
  await Promise.all([...open].map((socket) => socket.close()));
  await expect(indicator(page)).toHaveText("Reconnecting…");
  const resultsBefore = results.length;

  reachable = true;
  await expect(indicator(page)).toHaveCount(0, { timeout: 60_000 });
  // The reconnected socket subscribes again and the backend delivers fresh results.
  await expect.poll(() => results.slice(resultsBefore)).toEqual(expect.arrayContaining(pagePaths));
});
