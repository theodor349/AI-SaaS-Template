import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyChecks,
  collectActivity,
  evaluate,
  evaluateCodeRabbit,
  parseArgs,
  parseCodeRabbitComment,
  parseCodeRabbitReview,
  repoFromRemoteUrl,
} from "./pr-gate.mjs";

const head = "dabd98847b44b3340cdfdb1ecb3e47f367aec099";
const older = "9e320af12ae518ea0ce4c18bda8cbc9d6718e4b7";
const base = "39964d3685a68d142092e46a18701f05cda72300";
const pushedAt = "2026-10-13T14:27:58Z";
const minutesAfterPush = (minutes) => Date.parse(pushedAt) + minutes * 60_000;
const rabbit = { login: "coderabbitai[bot]", type: "Bot" };

// Shapes observed on this repository's PRs: the summary comment is edited in place.
const inProgressSummary = `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->
> [!NOTE]
> Currently processing new changes in this PR. This may take a few minutes, please wait...
> Reviewing files that changed from the base of the PR and between ${base} and ${head}.
<!-- end of auto-generated comment: review in progress by coderabbit.ai -->`;
const completedSummary = (reviewed) => `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- recent_review_start -->
No actionable comments were generated in the recent review. 🎉
Reviewing files that changed from the base of the PR and between ${base} and ${reviewed}.
<!-- recent_review_end -->
<!-- final_review_risk_coverage:{"sourceCommitId":"${reviewed}","coveredCommitId":"${reviewed}","kind":"reviewed"} -->`;
const rateLimitedComment = `<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->
> [!WARNING]
> ## Rate limit exceeded
> Please wait **12 minutes and 5 seconds** before requesting another review.`;

const comment = (body, updatedAt = "2026-10-13T14:28:39Z", user = rabbit) => ({
  id: 1, user, body, created_at: updatedAt, updated_at: updatedAt, html_url: "https://github.com/o/r/pull/1#issuecomment-1",
});
const status = (state, description) => ({ context: "CodeRabbit", state, description });

test("arguments accept PR numbers and URLs and reject anything else", () => {
  assert.deepEqual(parseArgs(["#20", "--json"]), { json: true, coderabbitDisabled: false, help: false, pr: "20" });
  assert.equal(parseArgs(["https://github.com/o/r/pull/7/"]).pr, "https://github.com/o/r/pull/7");
  assert.throws(() => parseArgs(["main"]), /PR number or GitHub PR URL/);
  assert.throws(() => parseArgs(["1", "2"]), /Usage/);
});

test("remote URLs resolve to lowercase owner/name for SSH and HTTPS", () => {
  assert.equal(repoFromRemoteUrl("https://github.com/theodor349/AI-SaaS-Template.git"), "theodor349/ai-saas-template");
  assert.equal(repoFromRemoteUrl("git@github.com:fork/AI-SaaS-Template"), "fork/ai-saas-template");
  assert.equal(repoFromRemoteUrl("https://gitlab.com/o/r.git"), undefined);
});

test("an in-progress summary does not count its target range as reviewed", () => {
  const parsed = parseCodeRabbitComment(inProgressSummary);
  assert.equal(parsed.inProgress, true);
  assert.equal(parsed.inProgressCommit, head);
  assert.deepEqual(parsed.reviewedCommits, []);
  const done = parseCodeRabbitComment(completedSummary(head));
  assert.equal(done.inProgress, false);
  assert.equal(done.noFindings, true);
  assert.deepEqual([...new Set(done.reviewedCommits)], [head]);
  const limited = parseCodeRabbitComment(rateLimitedComment);
  assert.equal(limited.rateLimited, true);
  assert.equal(limited.retryAfter, "12 minutes and 5 seconds");
});

test("review bodies report actionable, nitpick, and outside-diff counts", () => {
  const counts = parseCodeRabbitReview("**Actionable comments posted: 2**\n<summary>🧹 Nitpick comments (1)</summary>\n<summary>⚠️ Outside diff range comments (3)</summary>");
  assert.deepEqual(counts, { actionable: 2, nitpicks: 1, outsideDiff: 3, duplicates: 0 });
});

test("CodeRabbit gate passes only when a completed review covers the head", () => {
  const now = minutesAfterPush(3);
  const pending = evaluateCodeRabbit({ head, pushedAt, now, statuses: [status("pending", "Review in progress")], comments: [comment(inProgressSummary)] });
  assert.equal(pending.state, "in_progress");
  assert.equal(pending.gate, "wait");

  const completed = evaluateCodeRabbit({ head, pushedAt, now, statuses: [status("success", "Review completed")], comments: [comment(completedSummary(head))] });
  assert.equal(completed.gate, "pass");
  assert.deepEqual(completed.coveredBy, ["commit status", "summary comment"]);

  const staleInput = {
    head, pushedAt,
    reviews: [
      { id: 1, user: rabbit, state: "COMMENTED", commit_id: older, body: "**Actionable comments posted: 1**", submitted_at: "2026-10-13T14:00:00Z" },
      // A thread reply on the new head is an empty-bodied review and must not satisfy the gate.
      { id: 2, user: rabbit, state: "COMMENTED", commit_id: head, body: "", submitted_at: "2026-10-13T14:29:00Z" },
    ],
    comments: [comment(completedSummary(older), "2026-10-13T14:00:00Z")],
  };
  const fresh = evaluateCodeRabbit({ ...staleInput, now });
  assert.equal(fresh.state, "not_started");
  assert.equal(fresh.gate, "wait");
  const late = evaluateCodeRabbit({ ...staleInput, now: minutesAfterPush(20) });
  assert.equal(late.gate, "action");
  assert.match(late.detail, /last reviewed 9e320af/);
});

test("CodeRabbit gate reports rate limits, unknown activity, and maintainer-confirmed disablement", () => {
  const limited = evaluateCodeRabbit({ head, pushedAt, comments: [comment(completedSummary(older), "2026-10-13T14:00:00Z"), comment(rateLimitedComment, "2026-10-13T14:30:00Z")] });
  assert.equal(limited.state, "rate_limited");
  assert.equal(limited.gate, "action");

  assert.equal(evaluateCodeRabbit({ head, pushedAt }).state, "unknown");
  assert.equal(evaluateCodeRabbit({ head, pushedAt }).gate, "action");
  const repoActive = evaluateCodeRabbit({ head, pushedAt, now: minutesAfterPush(1), repoActivity: { total: 3, recent: [21, 20] } });
  assert.equal(repoActive.state, "not_started");
  assert.equal(evaluateCodeRabbit({ head, pushedAt, disabled: true }).gate, "pass");
});

test("required checks decide what to wait for, while any failure needs action", () => {
  const checkRuns = [
    { name: "Unit tests", status: "completed", conclusion: "success", app: { slug: "github-actions" } },
    { name: "Preview", status: "in_progress", conclusion: null, app: { slug: "vercel" } },
    { name: "Review", status: "in_progress", conclusion: null, app: { slug: "coderabbitai" } },
  ];
  const required = { known: true, contexts: ["Unit tests", "Lint and typecheck", "CodeRabbit"] };
  const summary = classifyChecks({ checkRuns, statuses: [status("pending", "Review in progress")], required });
  assert.deepEqual(summary.checks.map((check) => [check.name, check.state, check.required]), [
    ["Unit tests", "passed", true],
    ["Preview", "pending", false],
    ["Lint and typecheck", "pending", true],
  ]);
  assert.equal(summary.requiredPending, 1);

  const fallback = classifyChecks({ checkRuns: checkRuns.slice(0, 2), statuses: [{ context: "Vercel", state: "failure" }], required: { known: false, contexts: [], reason: "HTTP 403" } });
  assert.equal(fallback.requiredPending, 1);
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

function snapshot(overrides = {}) {
  const value = {
    pr: {
      number: 20, url: "https://github.com/o/r/pull/20", title: "fix", state: "OPEN", isDraft: false,
      baseRepo: "o/r", baseRef: "main", headRepo: "o/r", headRef: "task", headSha: head,
      mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
    },
    git: { branch: "task", localHead: head, remoteHead: head, onPrBranch: true, dirty: [], baseLabel: "origin/main", baseSha: base, baseIsAncestor: true },
    pushedAt,
    required: { known: true, contexts: [], mergeQueue: false },
    checkRuns: [{ name: "Unit tests", status: "completed", conclusion: "success", app: { slug: "github-actions" } }],
    statuses: [status("success", "Review completed")],
    reviews: [], comments: [comment(completedSummary(head))], reviewComments: [], threads: [],
    coderabbit: { disabled: false },
  };
  for (const [key, patch] of Object.entries(overrides)) value[key] = Array.isArray(patch) ? patch : { ...value[key], ...patch };
  return value;
}

test("all gates green yields a ready verdict with the guarded merge command", () => {
  const result = evaluate(snapshot(), minutesAfterPush(15));
  assert.deepEqual(result.verdict.code, 0);
  assert.match(result.verdict.detail, new RegExp(`--match-head-commit ${head}`));
});

test("blockers and pending work map to action and waiting exit codes", () => {
  const now = minutesAfterPush(15);
  const notAncestor = evaluate(snapshot({ git: { baseIsAncestor: false } }), now);
  assert.equal(notAncestor.verdict.code, 2);
  assert.equal(notAncestor.verdict.detail, "Base");

  const localAhead = evaluate(snapshot({ git: { localHead: older } }), now);
  assert.equal(localAhead.verdict.code, 2);

  const thread = { isResolved: false, isOutdated: true, path: "a.ts", line: null, author: "coderabbitai", lastAuthor: "theodor349" };
  const unresolved = evaluate(snapshot({ threads: [thread, { ...thread, isResolved: true }] }), now);
  assert.equal(unresolved.verdict.detail, "Threads");
  assert.equal(unresolved.unresolved.length, 1);

  const reviewing = evaluate(snapshot({ statuses: [status("pending", "Review in progress")], comments: [comment(inProgressSummary)] }), now);
  assert.equal(reviewing.verdict.code, 1);
  assert.equal(reviewing.verdict.detail, "CodeRabbit");

  const remoteLag = evaluate(snapshot({ git: { remoteHead: older } }), now);
  assert.equal(remoteLag.verdict.code, 1);
});

test("a merged PR reports its merge commit and any gate the merged head never met", () => {
  const merged = evaluate(snapshot({
    pr: { state: "MERGED", mergeCommit: "8e84761256e52eceec42c9a953ef33f3b6cb7eb3", mergedAt: "2026-10-13T14:28:48Z" },
    git: { onPrBranch: false, branch: "other", localHead: base, remoteHead: null, baseIsAncestor: false },
    statuses: [status("pending", "Review in progress")], comments: [comment(inProgressSummary)],
  }), minutesAfterPush(60));
  assert.equal(merged.verdict.code, 0);
  assert.match(merged.verdict.detail, /8e84761.*not satisfied for the merged head: CodeRabbit/);
});
