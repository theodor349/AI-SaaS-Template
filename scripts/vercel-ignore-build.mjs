import { execFileSync } from "node:child_process";

// Paths that never change what a production build deploys. Everything else
// deploys, including convex/, which the build deploys to Convex, and the one
// script the build runs.
const notDeployed = [
  /^\.agents\//,
  /^\.claude\//,
  /^\.depot\//,
  /^docs\//,
  /^tests\//,
  /^scripts\/(?!sync-maintenance-mode\.mjs$)/,
  // Root files only: content/ holds Markdown the legal pages render.
  /^[^/]+\.md$/,
  /\.test\.(ts|tsx|mts|mjs)$/,
  /^playwright\.config\.mts$/,
  /^skills-lock\.json$/,
];

/**
 * An empty diff deploys: a redeploy of the same commit, such as the one that
 * pauses the app, must build.
 * @param {string[]} changedFiles paths relative to the repository root
 */
export function needsDeploy(changedFiles) {
  return changedFiles.length === 0 || changedFiles.some((file) => !notDeployed.some((pattern) => pattern.test(file)));
}

/** @param {string} base a commit to diff HEAD against */
function changedSince(base) {
  try {
    const output = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split("\n").filter(Boolean);
  } catch {
    return undefined;
  }
}

// Vercel's Ignored Build Step, set as ignoreCommand in vercel.json. Exit 0
// cancels the deployment and exit 1 builds it. Any doubt builds.
//
// VERCEL_GIT_PREVIOUS_SHA is the last successful deployment's commit, so
// skipped commits add up until one needs a build. Vercel has left it empty for
// some projects, and its clone keeps only 10 commits; either way this builds.
function main() {
  if (process.env.VERCEL_GIT_COMMIT_REF !== "main") {
    console.log("Skipping the build: only main deploys.");
    return 0;
  }
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!previous) {
    console.log("Building: Vercel did not report the last deployed commit.");
    return 1;
  }
  const changed = changedSince(previous);
  if (!changed) {
    console.log(`Building: git could not diff ${previous}.`);
    return 1;
  }
  if (needsDeploy(changed)) {
    console.log(`Building: the diff since ${previous} is empty or changes deployed files.`);
    return 1;
  }
  console.log(`Skipping the build: only docs, agent files, CI, tests, or dev scripts changed since ${previous}.`);
  return 0;
}

if (import.meta.main) process.exit(main());
