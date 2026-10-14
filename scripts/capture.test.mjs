import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureNames, captureOptions, evidenceDirectory } from "./capture.mjs";

test("capture options reject ambiguous or unsafe requests", () => {
  assert.deepEqual(captureOptions(["/billing", "/", "--label", "after", "--plan", "yearly", "--video", "2.5"]), {
    paths: ["/billing", "/"], label: "after", plan: "yearly", signedOut: false, out: null, waitFor: null, videoSeconds: 2.5,
  });
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
