import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureNames, captureOptions, evidenceDirectory } from "./capture.mjs";
import { findClerkTestUser } from "./clerk-test-user.mjs";

test("capture options reject ambiguous or unsafe requests", () => {
  assert.deepEqual(captureOptions(["/billing", "/", "--label", "after", "--plan", "yearly", "--video", "2.5"]), {
    paths: ["/billing", "/"], label: "after", plan: "yearly", user: null, signedOut: false, out: null, waitFor: null, videoSeconds: 2.5,
    colorScheme: "light",
  });
  assert.equal(captureOptions(["/", "--color-scheme", "dark"]).colorScheme, "dark");
  assert.throws(() => captureOptions(["/", "--color-scheme", "sepia"]), /--color-scheme/);
  assert.equal(captureOptions(["/"]).label, "capture");
  assert.throws(() => captureOptions([]), /Usage/);
  assert.throws(() => captureOptions(["/", "--plan", "yearly", "--signed-out"]), /--plan needs a signed-in user/);
  assert.throws(() => captureOptions(["/", "--plan", "weekly"]), /--plan must be one of/);
  for (const label of ["../escape", "a/b", ".hidden", ""]) assert.throws(() => captureOptions(["/", "--label", label]), /--label/);
  for (const seconds of ["0", "-1", "61", "soon"]) assert.throws(() => captureOptions(["/", "--video", seconds]), /--video/);
  assert.throws(() => captureOptions(["/", "--unknown"]), /Unknown option/);
});

test("evidence defaults outside the checkout and refuses directories inside it", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "capture evidence ")));
  try {
    const root = join(base, "worktree");
    const main = join(base, "main");
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(main);
    symlinkSync(root, join(base, "worktree-link"));
    const checkouts = [root, main];
    assert.equal(evidenceDirectory({ label: "after", worktreeId: "wt-0123456789ab", checkouts, base: join(base, "tmp") }),
      join(base, "tmp/pr-evidence/wt-0123456789ab/after"));
    assert.equal(evidenceDirectory({ out: join(base, "evidence"), label: "after", worktreeId: "wt-0123456789ab", checkouts }),
      join(base, "evidence"));
    for (const out of [root, join(root, ".github/pr-assets"), join(main, "shots"), join(base, "worktree-link/shots")]) {
      assert.throws(() => evidenceDirectory({ out, label: "after", worktreeId: "wt-0123456789ab", checkouts }), /Refusing/, out);
    }
    assert.throws(() => evidenceDirectory({ label: "after", worktreeId: "wt-0123456789ab", checkouts, base: join(root, "tmp") }), /Refusing/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("capture file names are readable and unique per path", () => {
  assert.deepEqual(captureNames(["/", "/billing?plan=yearly", "/Billing", "/billing", "/account/"]),
    ["home", "billing-plan-yearly", "billing", "billing-2", "account"]);
});

test("capture signs in an existing user only by a Clerk test address", () => {
  const options = captureOptions(["/", "--user", "scale+clerk_test@example.com", "--plan", "lifetime"]);
  assert.equal(options.user, "scale+clerk_test@example.com");
  assert.equal(options.plan, "lifetime");
  for (const email of ["person@example.com", "scale+clerk_test", "scale+clerk_test@localhost", "scale+clerk_testing@example.com", "clerk_test@example.com"]) {
    assert.throws(() => captureOptions(["/", "--user", email]), /--user must be a Clerk test address/, email);
  }
  assert.throws(() => captureOptions(["/", "--user", "scale+clerk_test@example.com", "--signed-out"]), /remove --signed-out/);
});

test("an existing capture user must be a development test account", async () => {
  const email = "scale+clerk_test@example.com";
  const development = { env: { CLERK_SECRET_KEY: "sk_test_placeholder" } };
  const revoked = [];
  const clerk = (users) => ({
    users: { getUserList: async ({ emailAddress }) => {
      assert.deepEqual(emailAddress, [email]);
      return { data: users };
    } },
    sessions: { revokeSession: async (id) => { revoked.push(id); } },
  });
  const account = (id, ...emails) => ({ id, firstName: "Synthetic", lastName: "Scale", emailAddresses: emails.map((emailAddress) => ({ emailAddress })) });

  const user = await findClerkTestUser(development, email, clerk([account("user_1", "Scale+Clerk_Test@example.com")]));
  assert.deepEqual({ id: user.id, email: user.email, name: user.name }, { id: "user_1", email, name: "Synthetic Scale" });
  assert.equal("cleanup" in user, false);
  await user.revokeSession("sess_1");
  assert.deepEqual(revoked, ["sess_1"]);

  await assert.rejects(findClerkTestUser({ env: { CLERK_SECRET_KEY: "sk_live_placeholder" } }, email, clerk([account("user_1", email)])), /development instance/);
  await assert.rejects(findClerkTestUser(development, "person@example.com", clerk([])), /--user must be a Clerk test address/);
  await assert.rejects(findClerkTestUser(development, email, clerk([])), /No Clerk development user/);
  await assert.rejects(findClerkTestUser(development, email, clerk([account("user_1", "other+clerk_test@example.com")])), /No Clerk development user/);
  await assert.rejects(findClerkTestUser(development, email, clerk([account("user_1", email), account("user_2", email)])), /2 Clerk development users/);
  await assert.rejects(findClerkTestUser(development, email, clerk([account("user_1", email, "person@example.com")])), /address without \+clerk_test/);
});
