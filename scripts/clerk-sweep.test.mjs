import assert from "node:assert/strict";
import test from "node:test";
import { selectSweep, sweepOptions } from "./clerk-sweep.mjs";

const hour = 3_600_000;
const now = 1_000 * hour;
const here = "wt-aaaaaaaaaaaa";
const there = "wt-bbbbbbbbbbbb";
const user = (id, ageHours, metadata, emails = [`${metadata.WORKTREE_ID}-1+clerk_test@gmail.com`]) => ({
  id, createdAt: now - ageHours * hour, publicMetadata: metadata, emailAddresses: emails.map((emailAddress) => ({ emailAddress })),
});
const organization = (id, ageHours, metadata) => ({ id, createdAt: now - ageHours * hour, privateMetadata: metadata });
const users = [
  user("agent-old", 3, { WORKTREE_ID: here, purpose: "local-agent-test" }),
  user("agent-new", 1, { WORKTREE_ID: here, purpose: "local-agent-test" }),
  user("review-day", 24, { WORKTREE_ID: here, purpose: "maintainer-review" }),
  user("review-week", 24 * 8, { WORKTREE_ID: here, purpose: "maintainer-review" }),
  user("other-worktree", 30, { WORKTREE_ID: there, purpose: "local-agent-test" }),
  user("real-person", 500, { WORKTREE_ID: here, purpose: "local-agent-test" }, ["person@example.com"]),
  user("mixed-emails", 500, { WORKTREE_ID: here, purpose: "local-agent-test" }, [`${here}+clerk_test@gmail.com`, "person@example.com"]),
  user("no-email", 500, { WORKTREE_ID: here, purpose: "local-agent-test" }, []),
  user("unknown-purpose", 500, { WORKTREE_ID: here, purpose: "demo" }),
  user("no-worktree", 500, { purpose: "local-agent-test" }, ["x+clerk_test@gmail.com"]),
  user("bad-worktree", 500, { WORKTREE_ID: "production", purpose: "local-agent-test" }, ["x+clerk_test@gmail.com"]),
  { id: "unlabeled", createdAt: 0, publicMetadata: {}, emailAddresses: [{ emailAddress: "x+clerk_test@gmail.com" }] },
];
const organizations = [
  organization("org-old", 3, { WORKTREE_ID: here, purpose: "local-agent-test" }),
  organization("org-new", 1, { WORKTREE_ID: here, purpose: "local-agent-test" }),
  organization("org-review", 500, { WORKTREE_ID: here, purpose: "maintainer-review" }),
  organization("org-other", 500, { WORKTREE_ID: there, purpose: "local-agent-test" }),
  organization("org-unlabeled", 500, {}),
];
const ids = (selection) => ({ users: selection.users.map(({ id }) => id), organizations: selection.organizations.map(({ id }) => id) });

test("default sweep removes only this worktree's expired labeled test resources", () => {
  const selection = selectSweep({ users, organizations }, { now, worktreeId: here, olderThanMs: null });
  assert.deepEqual(ids(selection), { users: ["agent-old", "review-week"], organizations: ["org-old"] });
  assert.deepEqual({ labeled: selection.labeled, otherWorktree: selection.otherWorktree, tooRecent: selection.tooRecent },
    { labeled: 8, otherWorktree: 2, tooRecent: 3 });
});

test("an explicit age applies to every purpose, and all-worktrees widens only the owner check", () => {
  assert.deepEqual(ids(selectSweep({ users, organizations }, { now, worktreeId: here, olderThanMs: 0 })),
    { users: ["agent-old", "agent-new", "review-day", "review-week"], organizations: ["org-old", "org-new"] });
  assert.deepEqual(ids(selectSweep({ users, organizations }, { now, worktreeId: null, olderThanMs: null })),
    { users: ["agent-old", "review-week", "other-worktree"], organizations: ["org-old", "org-other"] });
});

test("sweep options parse ages and refuse unknown flags", () => {
  assert.deepEqual(sweepOptions([]), { olderThanMs: null, allWorktrees: false, dryRun: false });
  assert.deepEqual(sweepOptions(["--older-than", "0s", "--all-worktrees", "--dry-run"]), { olderThanMs: 0, allWorktrees: true, dryRun: true });
  assert.throws(() => sweepOptions(["--older-than", "soon"]), /--older-than/);
  assert.throws(() => sweepOptions(["--everything"]), /Unknown option/);
});
