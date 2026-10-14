import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, CONSENT_POLICY_VERSION } from "../../lib/consent/cookie";
import { E2E_CRASH_COOKIE } from "../../lib/e2e-crash";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";
import { captureEvidence } from "./evidence.mjs";

const local = resolveLocalTestConfig();
const appUrl = local.config.env.APP_URL;

// Every test here starts as a first-time visitor.
test.use({ storageState: { cookies: [], origins: [] } });

// Bootstrap points browser Sentry at the app's fake ingest route (next.config.js).
// Development chunks of the SDK are named after its @sentry packages; the app's own
// tiny loader stub for lib/sentry/browser.ts may be fetched early and doesn't count.
function watchSentry(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (/sentry/i.test(request.url()) && !request.redirectedFrom()) requests.push(request);
  });
  const envelopes = () => requests.filter((request) => request.url().includes("/e2e/sentry/api/1/envelope"));
  return {
    code: () => requests.filter((request) => /\/_next\/static\/.*(@|%40)sentry/.test(request.url())),
    envelopes,
    crashReports: () => envelopes().filter((request) => {
      const body = request.postData() ?? "";
      return body.includes('"type":"event"') && body.includes("E2E client crash");
    }),
  };
}

function banner(page: Page) {
  return page.getByRole("region", { name: /^Cookies on/ });
}

// The guest controls render after hydration and Clerk load, by which time a banner would show.
async function hydrated(page: Page) {
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
}

// Client-side navigation keeps the page, and so the running services, alive.
async function navigate(page: Page, path: string) {
  await page.evaluate((target) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(target), path);
}

// Renders a client error into the page's error boundary.
async function crashOnClient(page: Page, context: BrowserContext) {
  await context.addCookies([{ name: E2E_CRASH_COOKIE, value: "client", url: appUrl }]);
  await navigate(page, "/e2e/crash");
  await expect(page.getByRole("heading", { name: "Something broke. Just a little." })).toBeVisible();
  await context.clearCookies({ name: E2E_CRASH_COOKIE });
}

async function setAnalytics(page: Page, granted: boolean) {
  await navigate(page, "/cookies");
  await page.getByRole("button", { name: "Cookie Preferences" }).click();
  const dialog = page.getByRole("dialog", { name: "Cookie Preferences" });
  await expect(dialog.getByRole("switch", { name: "Essential" })).toBeChecked();
  await expect(dialog.getByRole("switch", { name: "Essential" })).toBeDisabled();
  const analytics = dialog.getByRole("switch", { name: "Analytics" });
  await expect(analytics).toBeChecked({ checked: !granted });
  await analytics.click();
  await dialog.getByRole("button", { name: "Save preferences" }).click();
  await expect(dialog).toHaveCount(0);
}

function storedConsent(value: unknown) {
  return [{ name: CONSENT_COOKIE, value: encodeURIComponent(JSON.stringify(value)), url: appUrl }];
}

for (const width of [1280, 390]) {
  test(`the banner leaves the cookie page usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/cookies");
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole("cell", { name: "__client_uat" })).toBeVisible();
    await captureEvidence(page, `cookies-banner-${width}`);
    await page.getByRole("button", { name: "Cookie Preferences" }).click();
    const dialog = page.getByRole("dialog", { name: "Cookie Preferences" });
    await expect(dialog.getByRole("list", { name: "Analytics services" })).toContainText("Sentry");
    await captureEvidence(page, `preferences-${width}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
  });
}

test("Reject all never loads Sentry and is remembered", async ({ page, context }) => {
  const sentry = watchSentry(page);
  await page.goto("/cookies");
  await banner(page).getByRole("button", { name: "Reject all" }).click();
  await expect(banner(page)).toHaveCount(0);

  const cookie = (await context.cookies(appUrl)).find(({ name }) => name === CONSENT_COOKIE);
  expect(cookie).toMatchObject({ sameSite: "Lax", secure: appUrl.startsWith("https:") });
  expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(CONSENT_MAX_AGE_SECONDS - 60);
  expect(cookie!.expires - Date.now() / 1000).toBeLessThanOrEqual(CONSENT_MAX_AGE_SECONDS);

  await crashOnClient(page, context);
  await page.goto("/");
  await hydrated(page);
  await expect(banner(page)).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(sentry.code().map((request) => request.url())).toEqual([]);
  expect(sentry.envelopes()).toEqual([]);
});

test("Accept all starts Sentry, which reports client errors, and is remembered", async ({ page, context }) => {
  const sentry = watchSentry(page);
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  await captureEvidence(page, "landing-banner");
  await banner(page).getByRole("button", { name: "Accept all" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect.poll(() => sentry.code().length).toBeGreaterThan(0);

  await crashOnClient(page, context);
  await expect.poll(() => sentry.crashReports().length).toBe(1);
  expect(sentry.crashReports()[0].postData()).toContain(`"environment":"${local.config.id}"`);

  await page.goto("/");
  await hydrated(page);
  await expect(banner(page)).toHaveCount(0);
  await crashOnClient(page, context);
  await expect.poll(() => sentry.crashReports().length).toBe(2);
});

test("withdrawing analytics stops Sentry in the same page, and granting it again restarts it", async ({ page, context }) => {
  const sentry = watchSentry(page);
  await page.goto("/cookies");
  await banner(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(() => sentry.code().length).toBeGreaterThan(0);
  await page.evaluate(() => { (window as unknown as { samePage: boolean }).samePage = true; });

  await setAnalytics(page, false);
  await crashOnClient(page, context);
  await page.waitForTimeout(2000);
  expect(sentry.crashReports()).toEqual([]);

  await setAnalytics(page, true);
  await crashOnClient(page, context);
  await expect.poll(() => sentry.crashReports().length).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { samePage?: boolean }).samePage)).toBe(true);
});

test("a choice from another policy version, an expired choice, or a malformed cookie shows the banner again", async ({ page, context }) => {
  const decidedAt = new Date().toISOString();
  const expiredAt = new Date(Date.now() - (CONSENT_MAX_AGE_SECONDS + 86_400) * 1000).toISOString();
  await context.addCookies(storedConsent({ version: CONSENT_POLICY_VERSION, choices: { analytics: false }, decidedAt }));
  await page.goto("/cookies");
  await hydrated(page);
  await expect(banner(page)).toHaveCount(0);

  for (const value of [
    { version: CONSENT_POLICY_VERSION - 1, choices: { analytics: false }, decidedAt },
    { version: CONSENT_POLICY_VERSION, choices: { analytics: false }, decidedAt: expiredAt },
    "not a consent cookie",
  ]) {
    await context.addCookies(storedConsent(value));
    await page.goto("/cookies");
    await expect(banner(page)).toBeVisible();
  }
});
