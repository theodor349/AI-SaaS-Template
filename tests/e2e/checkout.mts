import { expect, type Page } from "@playwright/test";
import { waitOutRateLimit } from "../../scripts/rate-limit-retry.mjs";
import type { ActionOutcome, interceptConvexSync } from "./convex-sync.mjs";

// Clicks the plan button named `button` and waits for Polar's sandbox checkout,
// waiting out one RATE_LIMITED rejection as waitOutRateLimit describes. `sync`
// must come from interceptConvexSync before the page loaded, so the backend's
// answer to the real checkout action is visible here.
export async function openSandboxCheckout(page: Page, sync: Awaited<ReturnType<typeof interceptConvexSync>>, button: string) {
  await waitOutRateLimit(async () => {
    const answer = new Promise<ActionOutcome>((resolve) => {
      sync.onAction("billing/polar:checkout", async (call) => {
        call.forward();
        resolve(await call.forwardedAnswer);
      });
    });
    await page.getByRole("button", { name: button }).click();
    const outcome = await answer;
    if (!outcome.success) throw outcome.error;
  });
  await expect(page).toHaveURL(/https:\/\/sandbox\.polar\.sh\/checkout\//);
}
