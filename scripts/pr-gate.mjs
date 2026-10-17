import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const USAGE = "Usage: pnpm pr:gate [PR number|URL] [--json] [--coderabbit-disabled]";
const CODERABBIT = /^coderabbitai(\[bot\])?$/i;
const NO_CHECKS_GRACE_MS = 5 * 60_000;
const REVIEW_START_GRACE_MS = 10 * 60_000;
const EXIT = { pass: 0, wait: 1, action: 2, error: 3 };

export function parseArgs(argv) {
  const options = { json: false, coderabbitDisabled: false, help: false, pr: undefined };
  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    else if (arg === "--coderabbit-disabled") options.coderabbitDisabled = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (!arg.startsWith("-") && options.pr === undefined) options.pr = parsePrRef(arg);
    else throw new Error(USAGE);
  }
  return options;
}

export function parsePrRef(value) {
  const number = /^#?(\d+)$/.exec(value);
  if (number) return number[1];
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(value)) return value.replace(/\/$/, "");
  throw new Error(`Expected a PR number or GitHub PR URL, got "${value}".\n${USAGE}`);
}

export function repoFromRemoteUrl(url) {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

export function sameSha(a, b) {
  if (!a || !b) return false;
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x));
}

const isBot = (login = "", type) => type === "Bot" || /\[bot\]$/.test(login);
const isCodeRabbit = (login = "") => CODERABBIT.test(login);
const short = (sha) => (sha ? sha.slice(0, 7) : "none");
const time = (value) => (value ? Date.parse(value) : NaN);

export function excerpt(body = "", length = 140) {
  const text = body.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function classifyCheckRun(runItem) {
  if (runItem.status !== "completed") return "pending";
  if (runItem.conclusion === "success") return "passed";
  if (["neutral", "skipped"].includes(runItem.conclusion)) return "skipped";
  return "failed";
}

function classifyStatus(status) {
  if (status.state === "success") return "passed";
  if (status.state === "pending") return "pending";
  return "failed";
}

// CodeRabbit reports through its own commit status; the CodeRabbit gate evaluates it instead of CI.
export function classifyChecks({ checkRuns = [], statuses = [], required = { known: false, contexts: [] } }) {
  const checks = [
    ...checkRuns.filter((item) => item.app?.slug !== "coderabbitai").map((item) => ({
      name: item.name, kind: "check-run", app: item.app?.slug, state: classifyCheckRun(item),
      detail: item.conclusion ?? item.status, url: item.html_url,
    })),
    ...statuses.filter((item) => !/coderabbit/i.test(item.context)).map((item) => ({
      name: item.context, kind: "status", state: classifyStatus(item), detail: item.description ?? item.state, url: item.target_url || undefined,
    })),
  ];
  const requiredNames = required.known && required.contexts.length ? new Set(required.contexts) : undefined;
  for (const check of checks) check.required = requiredNames ? requiredNames.has(check.name) : true;
  const missing = requiredNames ? [...requiredNames].filter((name) => !/coderabbit/i.test(name) && !checks.some((check) => check.name === name)) : [];
  for (const name of missing) checks.push({ name, kind: "missing", state: "pending", required: true, detail: "required check not reported yet" });
  const count = (state, onlyRequired) => checks.filter((check) => check.state === state && (!onlyRequired || check.required)).length;
  return {
    checks,
    requiredSource: requiredNames ? "repository rules" : required.known ? "none configured; treating all checks as required" : `unavailable (${required.reason ?? "no access"}); treating all checks as required`,
    passed: count("passed"), skipped: count("skipped"), failed: count("failed"),
    pending: count("pending"), requiredPending: count("pending", true),
  };
}

const IN_PROGRESS_BLOCK = /<!-- This is an auto-generated comment: review in progress by coderabbit\.ai -->[\s\S]*?(?:<!-- end of auto-generated comment: review in progress by coderabbit\.ai -->|$)/gi;
// In-progress, rate-limit, skip, and pause notices can quote the range they would review.
const NOTICE_BLOCK = /<!-- This is an auto-generated comment: ([a-z ]*?(?:review in progress|rate limit|skip|pause)[a-z ]*?) by coderabbit\.ai -->[\s\S]*?(?:<!-- end of auto-generated comment: \1 by coderabbit\.ai -->|$)/gi;
const RANGE = /between ([0-9a-f]{7,40}) and ([0-9a-f]{7,40})/gi;

// Parses CodeRabbit's walkthrough/summary comment (edited in place) or any other comment it posts.
export function parseCodeRabbitComment(body = "") {
  const markers = [...body.matchAll(/auto-generated comment: ([a-z ]+?) by coderabbit\.ai/gi)].map((match) => match[1].toLowerCase());
  const inProgressBlocks = body.match(IN_PROGRESS_BLOCK) ?? [];
  const settled = body.replace(NOTICE_BLOCK, "");
  const retry = /wait \*\*([^*]+)\*\*/i.exec(body)?.[1] ?? /next included review available in ([^.*\n]+)/i.exec(body)?.[1];
  const rateLimited = markers.some((marker) => marker.includes("rate limit")) || /rate limit exceeded|review limit reached/i.test(body);
  const skipped = markers.some((marker) => marker.includes("skip")) || /review skipped/i.test(body);
  const paused = /reviews? (?:are |is )?paused/i.test(body);
  // A notice outside a delimited block leaves no way to tell its range from a review's, so it covers nothing.
  const unwrappedNotice = /rate limit exceeded|review limit reached|review skipped|reviews? (?:are |is )?paused/i.test(settled);
  return {
    markers: [...new Set(markers)],
    inProgress: inProgressBlocks.length > 0,
    inProgressCommit: inProgressBlocks.flatMap((block) => [...block.matchAll(RANGE)].map((match) => match[2])).at(-1),
    reviewedCommits: unwrappedNotice ? [] : [
      ...[...settled.matchAll(RANGE)].map((match) => match[2]),
      ...[...settled.matchAll(/"coveredCommitId":"([0-9a-f]{7,40})"/g)].map((match) => match[1]),
    ],
    rateLimited,
    skipped,
    paused,
    noFindings: /no actionable comments were generated/i.test(settled),
    retryAfter: retry,
  };
}

// Parses the counts in a submitted CodeRabbit review body.
export function parseCodeRabbitReview(body = "") {
  const count = (pattern) => Number(pattern.exec(body)?.[1] ?? 0);
  return {
    actionable: count(/Actionable comments posted: (\d+)/i),
    nitpicks: count(/Nitpick comments \((\d+)\)/i),
    outsideDiff: count(/Outside diff range comments \((\d+)\)/i),
    duplicates: count(/Duplicate comments \((\d+)\)/i),
  };
}

export function evaluateCodeRabbit({ head, pushedAt, now = Date.now(), disabled = false, statuses = [], checkRuns = [], reviews = [], comments = [], repoActivity, configFile, carryOver = {} }) {
  if (disabled) return { state: "disabled", gate: "pass", detail: "skipped with --coderabbit-disabled", evidence: [] };
  const status = statuses.find((item) => /coderabbit/i.test(item.context));
  const runs = checkRuns.filter((item) => item.app?.slug === "coderabbitai");
  const ownReviews = reviews.filter((item) => isCodeRabbit(item.user?.login));
  // Empty-bodied CodeRabbit reviews are containers for thread replies, not review passes.
  const submitted = ownReviews.filter((item) => item.body?.trim() && item.state !== "PENDING");
  const ownComments = comments.filter((item) => isCodeRabbit(item.user?.login));
  const summary = ownComments.filter((item) => /summarize by coderabbit|walkthrough_start|recent_review_start/i.test(item.body ?? ""))
    .sort((a, b) => time(a.updated_at) - time(b.updated_at)).at(-1);
  const parsedSummary = summary ? parseCodeRabbitComment(summary.body) : undefined;
  const recent = ownComments.filter((item) => item !== summary && !(time(item.updated_at) < time(pushedAt)))
    .map((item) => ({ ...parseCodeRabbitComment(item.body), at: item.updated_at }));
  const notices = [parsedSummary && { ...parsedSummary, at: summary.updated_at }, ...recent].filter(Boolean);

  const evidence = [];
  if (status) evidence.push(`commit status "${status.context}" on head: ${status.state} (${status.description ?? "no description"})`);
  if (runs.length) evidence.push(`${runs.length} CodeRabbit check run(s) on head`);
  if (ownReviews.length) evidence.push(`${ownReviews.length} review(s) on this PR`);
  if (ownComments.length) evidence.push(`${ownComments.length} comment(s) on this PR`);
  if (repoActivity?.total) evidence.push(`commented on ${repoActivity.total} PR(s) in this repository (latest #${repoActivity.recent.join(", #")})`);
  if (configFile) evidence.push(`${configFile} in the base repository`);

  const latestReview = submitted.sort((a, b) => time(a.submitted_at) - time(b.submitted_at)).at(-1);
  const coverage = [];
  if (status?.state === "success" && /complete/i.test(status.description ?? "")) coverage.push({ commit: head, source: "commit status" });
  for (const item of runs) if (item.status === "completed" && item.conclusion === "success") coverage.push({ commit: item.head_sha ?? head, source: "check run" });
  for (const item of submitted) coverage.push({ commit: item.commit_id, source: `review ${item.id}`, at: item.submitted_at });
  for (const commit of parsedSummary?.reviewedCommits ?? []) coverage.push({ commit, source: "summary comment" });
  const coversHead = coverage.filter((item) => sameSha(item.commit, head));
  const lastReviewedCommit = latestReview?.commit_id ?? parsedSummary?.reviewedCommits.at(-1);
  const headReview = submitted.filter((item) => sameSha(item.commit_id, head)).at(-1);
  const findings = headReview ? parseCodeRabbitReview(headReview.body) : undefined;
  const base = { evidence, lastReviewedCommit, coveredBy: [...new Set(coversHead.map((item) => item.source))], findings, summaryUrl: summary?.html_url };
  // A completed review of an earlier commit in the head's history still covers the
  // head unless a later merge was complicated: conflicted, or edited beyond what a
  // clean automatic merge produces. Those merges need a fresh review.
  const earlier = carryOver.unavailable ? [] : [...new Set(coverage.map((item) => item.commit))].filter((commit) => commit && !sameSha(commit, head))
    .map((commit) => ({ commit, ...carryOver[commit] })).filter((item) => item.ancestor);
  const carried = earlier.find((item) => !item.complicatedMerges?.length);
  const complicated = earlier.find((item) => item.complicatedMerges?.length);

  const inProgress = status?.state === "pending" || runs.some((item) => item.status !== "completed")
    || (parsedSummary?.inProgress && (!parsedSummary.inProgressCommit || sameSha(parsedSummary.inProgressCommit, head)));
  const rateLimited = notices.find((item) => item.rateLimited);
  const skipped = notices.some((item) => item.skipped || item.paused) || /skip/i.test(status?.description ?? "");
  const failed = status && ["failure", "error"].includes(status.state);

  if (!evidence.length) return { ...base, state: "unknown", gate: "action", detail: "no CodeRabbit activity, status, or config found; confirm with the maintainer whether it is enabled" };
  if (carried && (inProgress || !coversHead.length)) {
    const note = inProgress ? "; a newer review is in progress but not required" : "";
    return { ...base, state: "carried_over", gate: "pass", carriedFrom: carried.commit,
      detail: `completed review of ${short(carried.commit)} covers head ${short(head)}; no complicated merge since${note}` };
  }
  if (inProgress) return { ...base, state: "in_progress", gate: "wait", detail: `review in progress for ${short(parsedSummary?.inProgressCommit ?? head)}` };
  if (coversHead.length) {
    const extra = findings ? `; ${findings.actionable} actionable, ${findings.nitpicks} nitpick, ${findings.outsideDiff} outside-diff comment(s) in the review body` : "";
    return { ...base, state: "completed", gate: "pass", detail: `completed review covers head ${short(head)} (${base.coveredBy.join(", ")})${extra}` };
  }
  if (rateLimited) return { ...base, state: "rate_limited", gate: "action", detail: `rate limited${rateLimited.retryAfter ? `; retry ${rateLimited.retryAfter} after ${rateLimited.at}` : ""}; request a review once the limit clears` };
  if (skipped) return { ...base, state: "skipped", gate: "action", detail: `review skipped or paused for this head (${status?.description ?? "see CodeRabbit comment"})` };
  if (failed) return { ...base, state: "failed", gate: "action", detail: `CodeRabbit status ${status.state}: ${status.description ?? ""}` };
  const sincePush = now - time(pushedAt);
  const stale = carryOver.unavailable && lastReviewedCommit ? `last reviewed ${short(lastReviewedCommit)}, but ${carryOver.unavailable}`
    : complicated ? `merge ${short(complicated.complicatedMerges.at(-1))} after the review of ${short(complicated.commit)} was not a clean merge`
      : lastReviewedCommit ? `last reviewed ${short(lastReviewedCommit)}` : "no completed review yet";
  if (!(sincePush > REVIEW_START_GRACE_MS)) return { ...base, state: "not_started", gate: "wait", detail: `no review for head ${short(head)} yet (${stale})` };
  return { ...base, state: "not_started", gate: "action", detail: `no review started for head ${short(head)} ${Math.round(sincePush / 60_000)} min after push (${stale}); request one with @coderabbitai review` };
}

export function collectActivity({ pushedAt, reviews = [], comments = [], reviewComments = [] }) {
  const after = (value) => !pushedAt || time(value) > time(pushedAt);
  const item = (kind, entry, at) => ({
    kind, author: entry.user?.login, bot: isBot(entry.user?.login, entry.user?.type), at,
    url: entry.html_url, excerpt: excerpt(entry.body), state: entry.state,
  });
  return [
    ...comments.filter((entry) => after(entry.updated_at)).map((entry) => item("comment", entry, entry.updated_at)),
    ...reviews.filter((entry) => after(entry.submitted_at) && (entry.body?.trim() || entry.state !== "COMMENTED")).map((entry) => item("review", entry, entry.submitted_at)),
    ...reviewComments.filter((entry) => after(entry.updated_at)).map((entry) => item("inline", entry, entry.updated_at)),
  ].sort((a, b) => time(a.at) - time(b.at));
}

// The checkout counts as the PR's when it is on the PR branch or detached at its head.
const isLocalCheckout = (pr, git) => git.onPrBranch || git.localHead === pr.headSha;

function headsGate({ pr, git, open }) {
  const local = isLocalCheckout(pr, git);
  if (local && git.localHead !== pr.headSha) return { gate: "action", detail: `local HEAD ${short(git.localHead)} differs from PR head ${short(pr.headSha)}; push or reconcile` };
  if (git.remoteHead === null) return open
    ? { gate: "action", detail: `remote branch ${pr.headRef} is missing` }
    : { gate: "info", detail: `remote branch ${pr.headRef} no longer exists` };
  if (git.remoteHead === undefined) return { gate: "action", detail: `could not read remote branch ${pr.headRef}` };
  if (git.remoteHead !== pr.headSha) return open
    ? { gate: "wait", detail: `remote branch ${short(git.remoteHead)} differs from PR head ${short(pr.headSha)}; GitHub may still be syncing` }
    : { gate: "info", detail: `remote branch ${short(git.remoteHead)} differs from merged head ${short(pr.headSha)}` };
  const prefix = local ? `local = remote = PR head ${short(pr.headSha)}` : `remote = PR head ${short(pr.headSha)}`;
  return { gate: local ? "pass" : "info", detail: local ? prefix : `${prefix}; worktree is on ${git.branch}, not the PR branch` };
}

function mergeableGate(pr) {
  const { mergeable, mergeStateStatus: state, reviewDecision } = pr;
  const label = `${mergeable}/${state}${reviewDecision ? `, review ${reviewDecision}` : ""}`;
  if (pr.isDraft || state === "DRAFT") return { gate: "action", detail: `PR is a draft (${label})` };
  if (mergeable === "CONFLICTING" || state === "DIRTY") return { gate: "action", detail: `merge conflicts with base (${label})` };
  if (state === "BEHIND") return { gate: "action", detail: `branch is behind base (${label})` };
  if (reviewDecision === "CHANGES_REQUESTED" || reviewDecision === "REVIEW_REQUIRED") return { gate: "action", detail: `required review missing (${label})` };
  if (state === "BLOCKED") return { gate: "wait", detail: `blocked by repository requirements (${label}); check required checks and reviews` };
  if (mergeable === "UNKNOWN" || state === "UNKNOWN") return { gate: "wait", detail: `GitHub is still computing mergeability (${label})` };
  return { gate: "pass", detail: label };
}

function checksGate(summary, pushedAt, now) {
  const counts = `${summary.passed} passed, ${summary.pending} pending, ${summary.failed} failed, ${summary.skipped} skipped; required: ${summary.requiredSource}`;
  if (summary.failed) return { gate: "action", detail: counts };
  if (summary.requiredPending) return { gate: "wait", detail: counts };
  if (!summary.checks.length && now - time(pushedAt) < NO_CHECKS_GRACE_MS) return { gate: "wait", detail: "no checks reported yet for head" };
  return { gate: "pass", detail: summary.checks.length ? counts : "no checks reported for head" };
}

// Pure evaluation of a collected snapshot; see collect() for the shape.
export function evaluate(snapshot, now = Date.now()) {
  const { pr, git } = snapshot;
  const open = pr.state === "OPEN";
  const checks = classifyChecks(snapshot);
  const coderabbit = evaluateCodeRabbit({ ...snapshot.coderabbit, head: pr.headSha, pushedAt: snapshot.pushedAt, now, statuses: snapshot.statuses, checkRuns: snapshot.checkRuns, reviews: snapshot.reviews, comments: snapshot.comments });
  const unresolved = snapshot.threads.filter((thread) => !thread.isResolved);
  const gates = [];
  const add = (name, result) => gates.push({ name, ...result });

  add("Heads", headsGate({ pr, git, open }));
  if (!git.dirty.length) add("Worktree", { gate: "pass", detail: "no uncommitted changes" });
  else add("Worktree", { gate: isLocalCheckout(pr, git) && open ? "action" : "info", detail: `${git.dirty.length} uncommitted change(s)` });
  if (!open) add("Base", { gate: "info", detail: `not checked for a ${pr.state.toLowerCase()} PR` });
  else if (git.baseIsAncestor === true) add("Base", { gate: "pass", detail: `${git.baseLabel} ${short(git.baseSha)} is an ancestor of the head` });
  else if (git.baseIsAncestor === false) add("Base", { gate: "action", detail: `${git.baseLabel} ${short(git.baseSha)} is not an ancestor of the head; merge it into the branch` });
  else add("Base", { gate: "action", detail: `could not check ancestry: ${git.baseError ?? "unknown error"}` });
  add("Mergeable", open ? mergeableGate(pr) : { gate: "info", detail: pr.state });
  add("Checks", checksGate(checks, snapshot.pushedAt, now));
  add("CodeRabbit", { gate: coderabbit.gate, detail: coderabbit.detail });
  add("Threads", unresolved.length
    ? { gate: "action", detail: `${unresolved.length} unresolved (${unresolved.filter((thread) => thread.isOutdated).length} outdated)` }
    : { gate: "pass", detail: `${snapshot.threads.length} thread(s), none unresolved` });
  if (snapshot.required.mergeQueue) add("Merge queue", { gate: "info", detail: "base branch requires a merge queue" });

  const blocking = (kind) => gates.filter((gate) => gate.gate === kind).map((gate) => gate.name);
  let verdict;
  if (pr.state === "MERGED") {
    const unmet = [...blocking("action"), ...blocking("wait")];
    verdict = { code: EXIT.pass, label: "MERGED", detail: `merge commit ${pr.mergeCommit ?? "unknown"} at ${pr.mergedAt ?? "unknown time"}${unmet.length ? `; gates not satisfied for the merged head: ${unmet.join(", ")}` : ""}` };
  } else if (pr.state === "CLOSED") verdict = { code: EXIT.action, label: "CLOSED", detail: "PR is closed without merging" };
  else {
    if (blocking("action").length) verdict = { code: EXIT.action, label: "ACTION NEEDED", detail: blocking("action").join(", ") };
    else if (blocking("wait").length) verdict = { code: EXIT.wait, label: "WAITING", detail: blocking("wait").join(", ") };
    else verdict = { code: EXIT.pass, label: "READY TO MERGE", detail: `gh pr merge ${pr.url} --match-head-commit ${pr.headSha}` };
  }
  return { gates, verdict, checks, coderabbit, unresolved, activity: collectActivity(snapshot) };
}

export function render(snapshot, result) {
  const { pr, git } = snapshot;
  const lines = [`PR #${pr.number} ${pr.title} (${pr.state})`, pr.url, `Head ${pr.headSha} on ${pr.headRepo}:${pr.headRef}, pushed ${snapshot.pushedAt ?? "unknown"}`, ""];
  const width = Math.max(...result.gates.map((gate) => gate.name.length));
  for (const gate of result.gates) lines.push(`${gate.name.padEnd(width)}  ${gate.gate.toUpperCase().padEnd(6)}  ${gate.detail}`);
  const notable = result.checks.checks.filter((check) => check.state !== "passed");
  if (notable.length) {
    lines.push("", "Checks not passed:");
    for (const check of notable) lines.push(`  ${check.state.padEnd(7)} ${check.name}${check.required ? "" : " (not required)"} - ${check.detail}${check.url ? ` ${check.url}` : ""}`);
  }
  if (result.coderabbit.evidence.length) lines.push("", `CodeRabbit evidence: ${result.coderabbit.evidence.join("; ")}`);
  if (result.unresolved.length) {
    lines.push("", "Unresolved threads:");
    for (const thread of result.unresolved) {
      lines.push(`  ${thread.path}:${thread.line ?? thread.originalLine ?? "?"}${thread.isOutdated ? " (outdated)" : ""} by ${thread.author}, last reply ${thread.lastAuthor} - ${thread.excerpt}`, `    ${thread.url}`);
    }
  }
  if (result.activity.length) {
    lines.push("", `Activity since head push (${result.activity.length}):`);
    for (const item of result.activity.slice(-15)) lines.push(`  ${item.at} ${item.kind} ${item.author}${item.bot ? " (bot)" : ""}${item.state ? ` ${item.state}` : ""}: ${item.excerpt}`, `    ${item.url}`);
  }
  if (git.dirty.length) lines.push("", "Uncommitted:", ...git.dirty.slice(0, 20).map((line) => `  ${line}`));
  lines.push("", `Verdict: ${result.verdict.label} - ${result.verdict.detail} (exit ${result.verdict.code})`);
  return lines.join("\n");
}

async function command(file, args, options = {}) {
  try {
    const { stdout } = await run(file, args, { maxBuffer: 64 * 1024 * 1024, ...options });
    return stdout;
  } catch (error) {
    const message = (error.stderr || error.message || "").trim().split("\n").at(-1);
    throw Object.assign(new Error(`${file} ${args.slice(0, 3).join(" ")}: ${message}`), { exitCode: error.code, stderr: error.stderr ?? "" });
  }
}

const git = (args) => command("git", args).then((out) => out.trim());
const ghJson = async (args) => JSON.parse(await command("gh", args));
const ghPages = (path) => ghJson(["api", "--paginate", "--slurp", path]);
const ghList = async (path, key) => (await ghPages(path)).flatMap((page) => (key ? page[key] : page));
const notFound = (error) => /HTTP 404|Not Found|Branch not protected/i.test(error.stderr || error.message);

async function ghOptional(args) {
  try { return await ghJson(args); } catch (error) { if (notFound(error)) return undefined; throw error; }
}

async function requiredChecks(repo, base) {
  try {
    const branch = await ghJson(["api", `repos/${repo}/branches/${encodeURIComponent(base)}`]);
    const rules = await ghList(`repos/${repo}/rules/branches/${encodeURIComponent(base)}?per_page=100`);
    const protection = branch.protection?.required_status_checks ?? {};
    const contexts = new Set([...(protection.contexts ?? []), ...(protection.checks ?? []).map((check) => check.context)]);
    for (const rule of rules) if (rule.type === "required_status_checks") for (const check of rule.parameters?.required_status_checks ?? []) contexts.add(check.context);
    return { known: true, contexts: [...contexts], mergeQueue: rules.some((rule) => rule.type === "merge_queue") };
  } catch (error) {
    return { known: false, contexts: [], reason: error.message, mergeQueue: false };
  }
}

const THREADS = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id isResolved isOutdated path line originalLine
      first: comments(first: 1) { totalCount nodes { author { login } body url } }
      last: comments(last: 1) { nodes { author { login } } } }
  } } } }`;

async function reviewThreads(repo, number) {
  const [owner, name] = repo.split("/");
  const threads = [];
  let cursor;
  do {
    const args = ["api", "graphql", "-f", `query=${THREADS}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    const page = (await ghJson(args)).data.repository.pullRequest.reviewThreads;
    for (const node of page.nodes) {
      const first = node.first.nodes[0];
      threads.push({
        id: node.id, isResolved: node.isResolved, isOutdated: node.isOutdated, path: node.path, line: node.line, originalLine: node.originalLine,
        author: first?.author?.login, excerpt: excerpt(first?.body), url: first?.url, comments: node.first.totalCount, lastAuthor: node.last.nodes[0]?.author?.login,
      });
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined;
  } while (cursor);
  return threads;
}

async function remotes() {
  const out = await git(["remote", "-v"]);
  return out.split("\n").filter((line) => line.endsWith("(fetch)")).map((line) => {
    const [name, url] = line.split(/\s+/);
    return { name, repo: repoFromRemoteUrl(url) };
  });
}

function pickRemote(list, repo, preferred) {
  const matches = list.filter((remote) => remote.repo === repo?.toLowerCase());
  return (matches.find((remote) => remote.name === preferred) ?? matches.find((remote) => remote.name === "origin") ?? matches[0])?.name;
}

async function gitState(pr) {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const localHead = await git(["rev-parse", "HEAD"]);
  const dirty = (await command("git", ["status", "--porcelain"])).split("\n").filter(Boolean);
  const list = await remotes();
  const preferred = branch === "HEAD" ? undefined : await git(["config", `branch.${branch}.remote`]).catch(() => undefined);
  const headRemote = pickRemote(list, pr.headRepo, preferred);
  const baseRemote = pickRemote(list, pr.baseRepo, preferred);
  const state = { branch, localHead, dirty, headRemote, baseRemote, onPrBranch: branch === pr.headRef && headRemote !== undefined };

  const target = headRemote ?? `https://github.com/${pr.headRepo}.git`;
  try {
    const line = await git(["ls-remote", target, `refs/heads/${pr.headRef}`]);
    state.remoteHead = line ? line.split(/\s+/)[0] : null;
  } catch { state.remoteHead = undefined; }

  if (!baseRemote) {
    state.baseIsAncestor = null;
    state.baseError = `no git remote points at ${pr.baseRepo}`;
    return state;
  }
  state.baseLabel = `${baseRemote}/${pr.baseRef}`;
  try {
    await git(["fetch", "--quiet", "--no-tags", baseRemote, `+refs/heads/${pr.baseRef}:refs/remotes/${baseRemote}/${pr.baseRef}`]);
    state.baseSha = await git(["rev-parse", `refs/remotes/${baseRemote}/${pr.baseRef}`]);
    await git(["cat-file", "-e", `${pr.headSha}^{commit}`]).catch(() => git(["fetch", "--quiet", "--no-tags", baseRemote, `refs/pull/${pr.number}/head`]));
    await run("git", ["merge-base", "--is-ancestor", state.baseSha, pr.headSha]).then(
      () => { state.baseIsAncestor = true; },
      (error) => {
        if (error.code === 1) state.baseIsAncestor = false;
        else { state.baseIsAncestor = null; state.baseError = (error.stderr || error.message).trim(); }
      },
    );
  } catch (error) {
    state.baseIsAncestor = null;
    state.baseError = error.message;
  }
  return state;
}

// For each earlier reviewed commit, records whether it is in the head's history and
// which later merges were complicated: conflicted, or with a result that differs from
// the tree a clean automatic merge of the same parents produces. A shallow clone can
// hide merges, so it carries nothing over.
export async function reviewCarryOver(head, commits, { cwd } = {}) {
  const repoGit = (args) => command("git", args, { cwd }).then((out) => out.trim());
  if (await repoGit(["rev-parse", "--is-shallow-repository"]) === "true") {
    return { unavailable: "this checkout is shallow; run git fetch --unshallow so earlier reviews can carry over" };
  }
  const result = {};
  for (const commit of new Set(commits)) {
    if (!commit || sameSha(commit, head)) continue;
    // A reviewed commit missing locally, e.g. after a force push, is not in the head's history.
    const known = await repoGit(["cat-file", "-e", `${commit}^{commit}`]).then(() => true, () => false);
    const ancestor = known && await repoGit(["merge-base", "--is-ancestor", commit, head]).then(() => true, (error) => {
      if (error.exitCode === 1) return false;
      throw error;
    });
    if (!ancestor) { result[commit] = { ancestor }; continue; }
    const merges = (await repoGit(["rev-list", "--merges", "--parents", "--reverse", `${commit}..${head}`])).split("\n").filter(Boolean).map((line) => line.split(" "));
    const complicatedMerges = [];
    for (const [merge, ...parents] of merges) {
      const automatic = parents.length === 2
        ? await repoGit(["merge-tree", "--write-tree", ...parents]).then((out) => out.split("\n")[0], () => null)
        : null;
      if (!automatic || automatic !== await repoGit(["rev-parse", `${merge}^{tree}`])) complicatedMerges.push(merge);
    }
    result[commit] = { ancestor, complicatedMerges };
  }
  return result;
}

const PR_FIELDS = "number,url,title,state,isDraft,baseRefName,headRefName,headRefOid,headRepository,headRepositoryOwner,mergeable,mergeStateStatus,reviewDecision,mergeCommit,mergedAt";

export async function collect(options) {
  const view = await ghJson(["pr", "view", ...(options.pr ? [options.pr] : []), "--json", PR_FIELDS]);
  const baseRepo = repoFromRemoteUrl(view.url.replace(/\/pull\/\d+$/, ""));
  const pr = {
    number: view.number, url: view.url, title: view.title, state: view.state, isDraft: view.isDraft,
    baseRepo, baseRef: view.baseRefName, headRef: view.headRefName, headSha: view.headRefOid,
    headRepo: (view.headRepository?.nameWithOwner ?? `${view.headRepositoryOwner?.login}/${view.headRepository?.name}`).toLowerCase(),
    mergeable: view.mergeable, mergeStateStatus: view.mergeStateStatus, reviewDecision: view.reviewDecision || undefined,
    mergeCommit: view.mergeCommit?.oid, mergedAt: view.mergedAt || undefined,
  };
  const repo = `repos/${baseRepo}`;
  const [gitInfo, required, checkRuns, statuses, suites, reviews, comments, reviewComments, threads] = await Promise.all([
    gitState(pr),
    requiredChecks(baseRepo, pr.baseRef),
    ghList(`${repo}/commits/${pr.headSha}/check-runs?per_page=100`, "check_runs"),
    ghList(`${repo}/commits/${pr.headSha}/status?per_page=100`, "statuses"),
    ghList(`${repo}/commits/${pr.headSha}/check-suites?per_page=100`, "check_suites"),
    ghList(`${repo}/pulls/${pr.number}/reviews?per_page=100`),
    ghList(`${repo}/issues/${pr.number}/comments?per_page=100`),
    ghList(`${repo}/pulls/${pr.number}/comments?per_page=100`),
    reviewThreads(baseRepo, pr.number),
  ]);
  // Check suites are created when GitHub receives the push, so the earliest one approximates push time.
  let pushedAt = suites.map((suite) => suite.created_at).sort()[0];
  if (!pushedAt) pushedAt = (await ghJson(["api", `${repo}/commits/${pr.headSha}`])).commit?.committer?.date;

  const coderabbit = { disabled: options.coderabbitDisabled };
  const reviewedCommits = [
    ...reviews.filter((item) => isCodeRabbit(item.user?.login) && item.body?.trim()).map((item) => item.commit_id),
    ...comments.filter((item) => isCodeRabbit(item.user?.login)).flatMap((item) => parseCodeRabbitComment(item.body).reviewedCommits ?? []),
  ];
  if (!options.coderabbitDisabled) coderabbit.carryOver = await reviewCarryOver(pr.headSha, reviewedCommits);
  const onPr = statuses.some((item) => /coderabbit/i.test(item.context))
    || [...reviews, ...comments, ...reviewComments].some((item) => isCodeRabbit(item.user?.login));
  if (!onPr && !options.coderabbitDisabled) {
    const search = await ghJson(["api", "-X", "GET", "search/issues", "-f", `q=repo:${baseRepo} is:pr commenter:app/coderabbitai`, "-f", "sort=updated", "-f", "per_page=5"]);
    coderabbit.repoActivity = { total: search.total_count, recent: search.items.map((item) => item.number) };
    for (const file of [".coderabbit.yaml", ".coderabbit.yml"]) {
      if (await ghOptional(["api", `${repo}/contents/${file}`])) { coderabbit.configFile = file; break; }
    }
  }
  return { pr, git: gitInfo, pushedAt, required, checkRuns, statuses, reviews, comments, reviewComments, threads, coderabbit };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(USAGE); return; }
    const snapshot = await collect(options);
    const result = evaluate(snapshot);
    if (options.json) {
      const { reviews: _reviews, comments: _comments, reviewComments: _inline, checkRuns: _runs, statuses: _statuses, ...rest } = snapshot;
      console.log(JSON.stringify({ ...rest, ...result, checks: result.checks }, null, 2));
    } else console.log(render(snapshot, result));
    process.exitCode = result.verdict.code;
  } catch (error) {
    if (options?.json) console.log(JSON.stringify({ error: error.message, verdict: { code: EXIT.error, label: "ERROR" } }));
    else console.error(`PR gate: ${error.message}`);
    process.exitCode = EXIT.error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
