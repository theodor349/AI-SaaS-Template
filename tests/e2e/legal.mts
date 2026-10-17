import { expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

// Accepts the current terms where checkout or the paid product asks for them.
export async function acceptTerms(page: Page) {
  const accept = page.getByRole("button", { name: "Accept and continue" });
  await accept.click();
  await expect(accept).toHaveCount(0);
}

// Records acceptance for the signed-in user without the UI, for tests about
// something else. Call it before loading the page under test.
export async function acceptTermsAsUser(page: Page) {
  const token = await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" }));
  const client = new ConvexHttpClient(resolveLocalTestConfig().config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  client.setAuth(token!);
  await expect.poll(async () => (await client.query(api.account.users.current, {})).status).toBe("ready");
  await client.mutation(api.account.legal.accept, {});
}
