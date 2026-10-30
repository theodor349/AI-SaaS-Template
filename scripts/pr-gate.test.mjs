import assert from "node:assert/strict";
import test from "node:test";
import { classifyChecks, collectActivity, evaluate, parseArgs, repoFromRemoteUrl } from "./pr-gate.mjs";

const head = "dabd98847b44b3340cdfdb1ecb3e47f367aec099";
const older = "9e320af12ae518ea0ce4c18bda8cbc9d6718e4b7";
const base = "39964d3685a68d142092e46a18701f05cda72300";
const pushedAt = "2026-10-13T14:27:58Z";
const minutesAfterPush = (minutes) => Date.parse(pushedAt) + minutes * 60_000;
const bot = { login: "github-actions[bot]", type: "Bot" };
const comment = (body, updatedAt = "2026-10-13T14:28:39Z", user = bot) => ({
  id: 1, user, body, created_at: updatedAt, updated_at: updatedAt, html_url: "https://github.com/o/r/pull/1#issuecomment-1",
});
const pendingRun = { name: "Unit tests", status: "in_progress", conclusion: null, app: { slug: "github-actions" } };

test("arguments accept PR numbers and URLs and reject anything else", () => {
  assert.deepEqual(parseArgs(["#20", "--json"]), { json: true, help: false, pr: "20" });
  assert.equal(parseArgs(["https://github.com/o/r/pull/7/"]).pr, "https://github.com/o/r/pull/7");
  assert.throws(() => parseArgs(["main"]), /PR number or GitHub PR URL/);
  assert.throws(() => parseArgs(["1", "2"]), /Usage/);
});

test("remote URLs resolve to lowercase owner/name for SSH and HTTPS", () => {
  assert.equal(repoFromRemoteUrl("https://github.com/theodor349/AI-SaaS-Template.git"), "theodor349/ai-saas-template");
  assert.equal(repoFromRemoteUrl("git@github.com:fork/AI-SaaS-Template"), "fork/ai-saas-template");
  assert.equal(repoFromRemoteUrl("https://gitlab.com/o/r.git"), undefined);
});

test("missing required checks count as pending, and without repository rules every check is required", () => {
  const checkRuns = [
    { name: "Unit tests", status: "completed", conclusion: "success", app: { slug: "github-actions" } },
    { name: "Preview", status: "in_progress", conclusion: null, app: { slug: "vercel" } },
  ];
  const required = { known: true, contexts: ["Unit tests", "Lint and typecheck"] };
  const summary = classifyChecks({ checkRuns, statuses: [{ context: "Docs", state: "pending", description: "Building" }], required });
  assert.deepEqual(summary.checks.map((check) => [check.name, check.state, check.required]), [
    ["Unit tests", "passed", true],
    ["Preview", "pending", false],
    ["Docs", "pending", false],
    ["Lint and typecheck", "pending", true],
  ]);
  assert.equal(summary.pending, 3);

  const fallback = classifyChecks({ checkRuns: checkRuns.slice(0, 2), statuses: [{ context: "Vercel", state: "failure" }], required: { known: false, contexts: [], reason: "HTTP 403" } });
  assert.ok(fallback.checks.every((check) => check.required));
  assert.equal(fallback.failed, 1);
  assert.match(fallback.requiredSource, /HTTP 403.*treating all checks as required/);
});

test("activity lists only comments and reviews updated after the head push", () => {
  const activity = collectActivity({
    pushedAt,
    comments: [comment("old", "2026-10-13T14:00:00Z", { login: "theodor349", type: "User" }), comment("new", "2026-10-13T14:40:00Z")],
    reviews: [
      { user: { login: "theodor349" }, state: "COMMENTED", body: "", submitted_at: "2026-10-13T14:41:00Z" },
      { user: { login: "theodor349" }, state: "CHANGES_REQUESTED", body: "", submitted_at: "2026-10-13T14:42:00Z" },
    ],
    reviewComments: [{ user: { login: "theodor349", type: "User" }, body: "<!-- hidden -->Fixed in abc", updated_at: "2026-10-13T14:43:00Z" }],
  });
  assert.deepEqual(activity.map((item) => [item.kind, item.bot, item.excerpt]), [
    ["comment", true, "new"],
    ["review", false, ""],
    ["inline", false, "Fixed in abc"],
  ]);
});

const url = "https://github.com/o/r/pull/20";

function snapshot(overrides = {}) {
  const value = {
    pr: {
      number: 20, url, title: "fix", state: "OPEN", isDraft: false,
      baseRepo: "o/r", baseRef: "main", headRepo: "o/r", headRef: "task", headSha: head,
      mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
    },
    git: { branch: "task", localHead: head, remoteHead: head, onPrBranch: true, dirty: [], baseLabel: "origin/main", baseSha: base, baseIsAncestor: true },
    pushedAt,
    required: { known: true, contexts: [], mergeQueue: false },
    mergeMethods: { squash: true, merge: true, rebase: true },
    checkRuns: [{ name: "Unit tests", status: "completed", conclusion: "success", app: { slug: "github-actions" } }],
    statuses: [],
    reviews: [], comments: [], reviewComments: [], threads: [],
  };
  for (const [key, patch] of Object.entries(overrides)) value[key] = Array.isArray(patch) ? patch : { ...value[key], ...patch };
  return value;
}

test("all gates green yields a ready verdict with the guarded merge command", () => {
  const result = evaluate(snapshot(), minutesAfterPush(15));
  assert.deepEqual(result.verdict.code, 0);
  assert.match(result.verdict.detail, new RegExp(`--match-head-commit ${head}`));
});

test("the merge command uses a method the repository allows, preferring squash", () => {
  const detail = (mergeMethods) => evaluate(snapshot({ mergeMethods }), minutesAfterPush(15)).verdict.detail;
  assert.equal(detail({}), `gh pr merge ${url} --match-head-commit ${head} --squash`);
  assert.match(detail({ squash: false }), / --merge$/);
  assert.match(detail({ squash: false, merge: false }), / --rebase$/);
});

test("a merge queue needs no merge method", () => {
  const result = evaluate(snapshot({ required: { mergeQueue: true } }), minutesAfterPush(15));
  assert.equal(result.verdict.detail, `gh pr merge ${url} --match-head-commit ${head}`);
});

test("unreadable merge settings print no method and say a flag is needed", () => {
  const result = evaluate(snapshot({ mergeMethods: { squash: undefined, merge: undefined, rebase: undefined } }), minutesAfterPush(15));
  assert.ok(result.verdict.detail.startsWith(`gh pr merge ${url} --match-head-commit ${head} (could not read`));
});

test("blockers and pending work map to action and waiting exit codes", () => {
  const now = minutesAfterPush(15);
  const notAncestor = evaluate(snapshot({ git: { baseIsAncestor: false } }), now);
  assert.equal(notAncestor.verdict.code, 2);
  assert.equal(notAncestor.verdict.detail, "Base");

  const localAhead = evaluate(snapshot({ git: { localHead: older } }), now);
  assert.equal(localAhead.verdict.code, 2);

  const thread = { isResolved: false, isOutdated: true, path: "a.ts", line: null, author: "github-actions[bot]", lastAuthor: "theodor349" };
  const unresolved = evaluate(snapshot({ threads: [thread, { ...thread, isResolved: true }] }), now);
  assert.equal(unresolved.verdict.detail, "Threads");
  assert.equal(unresolved.unresolved.length, 1);

  const checking = evaluate(snapshot({ checkRuns: [pendingRun] }), now);
  assert.equal(checking.verdict.code, 1);
  assert.equal(checking.verdict.detail, "Checks");

  const remoteLag = evaluate(snapshot({ git: { remoteHead: older } }), now);
  assert.equal(remoteLag.verdict.code, 1);

  for (const pr of [{ isDraft: true }, { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }]) {
    const blocked = evaluate(snapshot({ pr }), now);
    assert.equal(blocked.verdict.code, 2);
    assert.equal(blocked.verdict.detail, "Mergeable");
  }
  const computing = evaluate(snapshot({ pr: { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" } }), now);
  assert.equal(computing.verdict.code, 1);
  assert.equal(computing.verdict.detail, "Mergeable");

  // A detached checkout at the PR head is local, so its uncommitted edits block merging.
  const detachedDirty = evaluate(snapshot({ git: { branch: null, onPrBranch: false, dirty: [" M scripts/a.mjs"] } }), now);
  assert.equal(detachedDirty.verdict.code, 2);
  assert.equal(detachedDirty.verdict.detail, "Worktree");
  const elsewhereDirty = evaluate(snapshot({ git: { branch: "other", onPrBranch: false, localHead: older, dirty: [" M a.mjs"] } }), now);
  assert.notEqual(elsewhereDirty.verdict.detail, "Worktree");
});

test("a pending check that is not required still waits, while a skipped one passes", () => {
  const now = minutesAfterPush(15);
  const required = { known: true, contexts: ["Unit tests"], mergeQueue: false };
  const unitTests = { name: "Unit tests", status: "completed", conclusion: "success", app: { slug: "github-actions" } };
  const e2e = { name: "E2E", status: "queued", conclusion: null, app: { slug: "github-actions" } };
  const waiting = evaluate(snapshot({ required, checkRuns: [unitTests, e2e] }), now);
  assert.equal(waiting.verdict.code, 1);
  assert.equal(waiting.verdict.detail, "Checks");

  const skipped = evaluate(snapshot({ required, checkRuns: [unitTests, { ...e2e, status: "completed", conclusion: "skipped" }] }), now);
  assert.equal(skipped.verdict.code, 0);
});

test("a merged PR reports its merge commit and any gate the merged head never met", () => {
  const merged = evaluate(snapshot({
    pr: { state: "MERGED", mergeCommit: "8e84761256e52eceec42c9a953ef33f3b6cb7eb3", mergedAt: "2026-10-13T14:28:48Z" },
    git: { onPrBranch: false, branch: "other", localHead: base, remoteHead: null, baseIsAncestor: false },
    checkRuns: [pendingRun],
  }), minutesAfterPush(60));
  assert.equal(merged.verdict.code, 0);
  assert.match(merged.verdict.detail, /8e84761.*not satisfied for the merged head: Checks/);
});
