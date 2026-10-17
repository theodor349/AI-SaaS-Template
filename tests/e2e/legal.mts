import { expect, type Page } from "@playwright/test";

// Accepts updated terms where checkout or the paid product asks for them.
export async function acceptTerms(page: Page) {
  const accept = page.getByRole("button", { name: "Accept and continue" });
  await accept.click();
  await expect(accept).toHaveCount(0);
}
