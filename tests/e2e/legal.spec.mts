import { expect, test } from "@playwright/test";
import { appConfig } from "../../app.config";

for (const width of [390, 1280]) {
  test(`legal documents show company details and fit the screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/cookies", "Cookie Policy"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(`CVR ${appConfig.companyCvr}`).first()).toBeVisible();
      await expect(page.getByText(/\{\{|\}\}/)).toHaveCount(0);
      // Wide tables scroll inside their own container instead of widening the page.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await expect(page.getByRole("cell", { name: /__session/ })).toBeVisible();
  });
}
