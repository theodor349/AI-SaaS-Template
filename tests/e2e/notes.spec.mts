import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { billingTestAdmin, seedPaidTestUser } from "../../scripts/billing-test-fixtures.mjs";
import { adminMutation } from "../../scripts/billing-test-admin";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { interceptConvexSync } from "./convex-sync.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();

async function convexAs(page: Page) {
  const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
  const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  client.setAuth(token!);
  return client;
}

const notes = (page: Page) => page.getByRole("region", { name: "Your notes" }).getByRole("listitem");
const note = (page: Page, title: string) => notes(page).filter({ has: page.getByText(title, { exact: true }) });

test("a Pro user creates, edits, pages through, pins, and deletes notes", async ({ page }) => {
  const user = await createClerkTestUser(local);
  const admin = billingTestAdmin().client;
  let userId: Id<"users"> | undefined;
  try {
    await seedPaidTestUser(user);
    const sync = await interceptConvexSync(page);
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });

    // The list owns its skeleton while the page shell and composer stay usable.
    sync.holdResponses("notes/notes:list");
    await page.goto("/app");
    await expect(page.getByRole("status").filter({ hasText: "Loading notes…" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Add note" })).toBeEnabled();
    await captureEvidence(page, "notes-skeleton");
    sync.releaseResponses();
    await expect(page.getByText("No notes yet")).toBeVisible();
    await captureEvidence(page, "notes-empty");

    // The server rejects a blank title next to its field, and the draft survives.
    await page.getByLabel("Title", { exact: true }).fill("   ");
    await page.getByLabel("Note", { exact: true }).fill("Milk and eggs");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Give the note a title of up to 200 characters.")).toBeVisible();
    await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Milk and eggs");

    // Adding stays pending, and blocks repeats, until the backend answers.
    await page.getByLabel("Title", { exact: true }).fill("Groceries");
    sync.holdResponses();
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByRole("button", { name: "Adding...", exact: true })).toBeDisabled();
    sync.releaseResponses();
    await expect(note(page, "Groceries")).toContainText("Milk and eggs");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
    await expect(notes(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Edit Groceries" }).click();
    const editor = page.getByRole("dialog", { name: "Edit note" });
    await editor.getByLabel("Title", { exact: true }).fill("Groceries for Friday");
    await editor.getByRole("button", { name: "Save note" }).click();
    await expect(editor).toHaveCount(0);
    await expect(note(page, "Groceries for Friday")).toBeVisible();

    // A loaded page grows with new notes, so reload to start from 20 per page.
    // The second page holds the oldest note.
    const client = await convexAs(page);
    for (let i = 1; i <= 20; i++) await client.mutation(api.notes.notes.create, { title: `Note ${i}`, body: "" });
    await page.reload();
    await expect(notes(page)).toHaveCount(20);
    await expect(notes(page).first()).toContainText("Note 20");
    await captureEvidence(page, "notes-loaded");
    await page.getByRole("button", { name: "Load more notes" }).click();
    await expect(notes(page)).toHaveCount(21);
    await expect(notes(page).last()).toContainText("Groceries for Friday");
    await expect(page.getByRole("button", { name: "Load more notes" })).toHaveCount(0);

    await page.getByRole("button", { name: "Delete Groceries for Friday" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete note" }).click();
    await expect(note(page, "Groceries for Friday")).toHaveCount(0);
    await expect(notes(page)).toHaveCount(20);

    // Pinning stays hidden until the notePinning flag is on for this user. The
    // flag changes the list's order, so the list starts again from its first page.
    await expect(page.getByRole("button", { name: "Pin Note 1", exact: true })).toHaveCount(0);
    const current = await client.query(api.account.users.current, {});
    if (current.status !== "ready") throw new Error("The test user is not ready");
    userId = current.user.id;
    await adminMutation(admin, internal.featureFlags.allowUser, { key: "notePinning", userId });
    const pin = page.getByRole("button", { name: "Pin Note 1", exact: true });
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
    await expect(notes(page).first().getByText("Note 1", { exact: true })).toBeVisible();
    await captureEvidence(page, "notes-pinned");
  } finally {
    if (userId) await adminMutation(admin, internal.featureFlags.disallowUser, { key: "notePinning", userId });
    await user.cleanup();
  }
});

test("a signed-in user without Pro is sent to billing, and the backend rejects their calls", async ({ page }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/"); await clerk.signIn({ page, emailAddress: user.email });
    await page.goto("/app");
    await expect(page).toHaveURL(`${local.config.env.APP_URL}/billing`);
    await expect(page.getByRole("heading", { name: "Notes", exact: true })).toHaveCount(0);

    const client = await convexAs(page);
    await expect(client.query(api.notes.notes.list, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("PAID_ACCESS_REQUIRED");
    await expect(client.mutation(api.notes.notes.create, { title: "Free note", body: "" })).rejects.toThrow("PAID_ACCESS_REQUIRED");
  } finally {
    await user.cleanup();
  }
});
