import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { createClerkTestUser } from "../../scripts/clerk-test-user.mjs";
import { resolveLocalTestConfig } from "../../scripts/local-test-config.mjs";

const local = resolveLocalTestConfig();

test("a first signed-in visit provisions through Clerk without a loopback webhook", { tag: "@critical" }, async ({ page, browser }) => {
  const alice = await createClerkTestUser(local);
  const bob = await createClerkTestUser(local);
  const otherContext = await browser.newContext({ baseURL: local.config.env.APP_URL });
  try {
    const otherPage = await otherContext.newPage();
    const records = [];
    for (const [target, user] of [[page, alice], [otherPage, bob]] as const) {
      await target.goto("/");
      await clerk.loaded({ page: target });
      await clerk.signIn({ page: target, emailAddress: user.email });
      const token = await target.evaluate(async () => {
        const sdk = (window as unknown as { Clerk: {
          session: { getToken: (options: { template: string }) => Promise<string | null> },
        } }).Clerk;
        return sdk.session.getToken({ template: "convex" });
      });
      expect(token).toBeTruthy();
      const client = new ConvexHttpClient(local.config.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
      client.setAuth(token!);
      await expect.poll(async () => (await client.query(api.account.users.current, {})).status).toBe("ready");
      const current = await client.query(api.account.users.current, {});
      expect(current.status).toBe("ready");
      if (current.status !== "ready") throw new Error("Account provisioning did not finish");
      expect(current.user.email).toBe(user.email);
      expect(current.user.displayName).toBe(user.name);
      expect(Object.keys(current.user).sort()).toEqual(["displayName", "email", "id"]);
      records.push(current.user.id);
      await target.reload();
      await expect.poll(async () => (await client.query(api.account.users.current, {})).status).toBe("ready");
      await expect(target.getByRole("alert").filter({ hasText: "Account setup failed" })).toHaveCount(0);
    }
    expect(records[0]).not.toBe(records[1]);
    await clerk.signOut({ page });
    await expect(page.getByRole("button", { name: "Retry account setup" })).toHaveCount(0);
  } finally {
    await otherContext.close();
    await Promise.all([alice.cleanup(), bob.cleanup()]);
  }
});
