import { readFile } from "node:fs/promises";
import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { JSONValue } from "convex/values";
import { appConfig } from "../../app.config";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { interceptConvexSync, type ActionCall } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

type Export = { app: string; formatVersion: number; exportedAt: string; sections: Record<string, Record<string, unknown>> };

async function exportData(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/-data-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(await readFile(await download.path(), "utf8")) as Export;
}

test("users download their data from the account page, including a pending deletion request", { tag: "@critical" }, async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    const sync = await interceptConvexSync(page);
    let call: ActionCall<Record<string, JSONValue>> | undefined;
    sync.onAction("account/dataExport:download", (held) => { call = held; });

    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/account");

    // The button stays pending, and blocks repeats, until the export settles.
    await page.getByRole("button", { name: "Export data" }).click();
    const preparing = page.getByRole("button", { name: "Preparing export...", exact: true });
    await expect(preparing).toBeDisabled();
    await captureEvidence(page, "data-export-pending");
    await expect.poll(() => call).toBeDefined();
    call!.fail("Server Error");
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t export your data" })).toBeVisible();
    await captureEvidence(page, "data-export-error");

    // A file that is gone by the time the browser fetches it reports the same failure.
    sync.onAction("account/dataExport:download", (held) => held.forward());
    let fetched = false;
    await page.route("**/api/storage/**", (route) => { fetched = true; return route.fulfill({ status: 404 }); }, { times: 1 });
    await page.getByRole("button", { name: "Export data" }).click();
    await expect.poll(() => fetched).toBe(true);
    await expect(page.getByRole("button", { name: "Export data" })).toBeEnabled();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t export your data" })).toBeVisible();

    const exported = await exportData(page);
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t export your data" })).toHaveCount(0);
    expect(exported).toMatchObject({
      app: appConfig.appName,
      formatVersion: 2,
      sections: {
        profile: { account: { email: user.email } },
        billing: { plan: null, subscriptions: [], orders: [] },
        accountLifecycle: { requests: [] },
      },
    });
    expect(Number.isNaN(Date.parse(exported.exportedAt))).toBe(false);

    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await page.getByRole("button", { name: "Request deletion", exact: true }).click();
    await expect(page.getByText(/Deletion scheduled for/)).toBeVisible();
    const afterRequest = await exportData(page);
    expect(afterRequest.sections.accountLifecycle.requests).toEqual([expect.objectContaining({ source: "user", status: "pending" })]);
  } finally {
    await user.cleanup();
  }
});
