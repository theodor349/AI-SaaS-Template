import { randomUUID } from "node:crypto";
import { clerk } from "@clerk/testing/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_CRASH_COOKIE } from "../../lib/e2e-crash";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();
const appUrl = local.config.env.APP_URL;

type SentryEvent = {
  environment?: string;
  user?: unknown;
  contexts?: { nextjs?: { request_path?: string; route_type?: string } };
  request?: { headers?: Record<string, string> };
};

// Server Sentry reports to bootstrap's fake ingest route (next.config.js), which
// returns the envelopes it received. Each envelope is a header line followed by
// pairs of item header and payload lines.
async function serverEvents(request: APIRequestContext, run: string) {
  const envelopes: string[] = await (await request.get("/e2e/sentry/api/1/envelope")).json();
  return envelopes.flatMap((envelope) => {
    const [, ...items] = envelope.split("\n");
    return items.flatMap((line, index) => {
      if (index % 2 || JSON.parse(line || "{}").type !== "event") return [];
      const event: SentryEvent = JSON.parse(items[index + 1]);
      return event.contexts?.nextjs?.request_path?.includes(run) ? [{ envelope, event }] : [];
    });
  });
}

test("server component, route handler, and Server Function errors reach Sentry without personal data", { tag: "@critical" }, async ({ page, context }) => {
  const user = await createClerkTestUser(local);
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: user.email });
    const run = randomUUID();
    const crashPage = `/e2e/crash?run=${run}`;
    const errorPage = page.getByRole("heading", { name: "Something broke. Just a little." });

    await context.addCookies([{ name: E2E_CRASH_COOKIE, value: "page", url: appUrl }]);
    await page.goto(crashPage);
    await expect(errorPage).toBeVisible();
    await context.clearCookies({ name: E2E_CRASH_COOKIE });

    expect((await page.request.get(`/e2e/crash/route?run=${run}`)).status()).toBe(500);

    await page.goto(crashPage);
    await page.getByRole("button", { name: "Run a crashing Server Function" }).click();

    await expect.poll(async () => {
      const routeTypes = (await serverEvents(page.request, run)).map(({ event }) => event.contexts?.nextjs?.route_type);
      return [...new Set(routeTypes)].sort();
    }).toEqual(["action", "render", "route"]);

    const session = (await context.cookies(appUrl)).find(({ name }) => name.startsWith("__session"))?.value;
    expect(session).toBeTruthy();
    for (const { envelope, event } of await serverEvents(page.request, run)) {
      // The release is the Vercel Git SHA, which local stacks don't have.
      expect(event.environment).toBe(local.config.id);
      expect(event.user).toBeUndefined();
      expect(event.request?.headers).not.toHaveProperty("cookie");
      for (const personal of [user.email, user.name, user.id, session!]) expect(envelope).not.toContain(personal);
    }
  } finally {
    await user.cleanup();
  }
});
