import { test, type Page } from "@playwright/test";

// PR evidence is opt-in so regression runs never write outside Playwright's output.
// `E2E_EVIDENCE=1 pnpm test:e2e <spec>` saves these screenshots, plus a video of each
// test (see playwright.config.mts), in the test's folder under .playwright/results.
export async function captureEvidence(page: Page, name: string) {
  if (!process.env.E2E_EVIDENCE) return;
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
