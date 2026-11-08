import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, matchesGlob } from "node:path";

const specMap = JSON.parse(readFileSync(new URL("../tests/e2e/spec-map.json", import.meta.url), "utf8"));
const matchesAny = (file, patterns) => patterns.some((pattern) => matchesGlob(file, pattern));

/**
 * Picks the E2E specs a change needs on top of the @critical tests, using the
 * rules in tests/e2e/spec-map.json. fullSuiteReason is set when the change
 * needs the full suite; specs still lists what the other files map to.
 * @param {string[]} changedFiles paths relative to the repository root
 */
export function selectSpecs(changedFiles, map = specMap) {
  /** @type {string | undefined} */
  let fullSuiteReason;
  /** @type {Map<string, string>} spec name to the first file that selected it */
  const specs = new Map();
  const add = (spec, file) => specs.has(spec) || specs.set(spec, file);
  for (const file of changedFiles) {
    if (matchesGlob(file, "tests/e2e/*.spec.mts")) {
      add(basename(file), file);
      continue;
    }
    if (matchesAny(file, map.criticalOnly)) continue;
    if (matchesAny(file, map.fullSuite)) {
      fullSuiteReason ??= `${file} is a shared file`;
      continue;
    }
    const areas = map.areas.filter((area) => matchesAny(file, area.paths));
    if (areas.length === 0) fullSuiteReason ??= `no rule maps ${file}`;
    for (const area of areas) for (const spec of area.specs) add(spec, file);
  }
  return {
    fullSuiteReason,
    specs: [...specs].map(([spec, file]) => ({ spec, file })).sort((a, b) => a.spec.localeCompare(b.spec)),
  };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A Playwright --grep pattern for the @critical tests plus every test in the
 * given spec files. Playwright ANDs file arguments with --grep, so the files go
 * into the pattern: it matches a string that holds the project name, the spec
 * file name, the titles, and the tags, separated by spaces.
 * @param {string[]} specs spec file names, such as "billing.spec.mts"
 */
export function grepFor(specs) {
  if (specs.length === 0) return "@critical";
  return `@critical|(^|\\s)(${specs.map(escapeRegExp).join("|")})(\\s|$)`;
}

/**
 * @param {ReturnType<typeof selectSpecs>} selection
 * @param {boolean} runsFullSuite false for a local run, which leaves the full suite to CI
 */
export function describeSelection({ fullSuiteReason, specs }, runsFullSuite) {
  const reason = `${fullSuiteReason} in tests/e2e/spec-map.json`;
  if (fullSuiteReason && runsFullSuite) return `Running the full suite: ${reason}.`;
  const lines = fullSuiteReason ? [`CI runs the full suite for this change: ${reason}. pnpm test:e2e runs it here.`] : [];
  if (specs.length === 0) lines.push("Running the @critical tests only. No changed file maps to a spec.");
  else lines.push(`Running the @critical tests plus ${specs.length} spec(s):`, ...specs.map(({ spec, file }) => `  ${spec} (${file})`));
  return lines.join("\n");
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const lines = (output) => output.split("\n").filter(Boolean);

/**
 * Files that differ between base and the working tree, including staged,
 * unstaged, and untracked files. --no-renames lists both sides of a rename.
 * @param {string} base
 */
function changedFiles(base) {
  return [...new Set([...lines(git("diff", "--name-only", "--no-renames", base)), ...lines(git("ls-files", "--others", "--exclude-standard"))])];
}

const usage = `Usage: pnpm test:e2e:affected [--base <rev>] [--github-output] [playwright options]

Runs the @critical E2E tests plus the specs tests/e2e/spec-map.json maps to the
files changed since <rev>, including uncommitted and untracked files. <rev>
defaults to the merge base with origin/main; fetch origin first. When a change
needs the full suite, this says so and leaves it to CI. Other options go to
playwright test, so --list shows the selection without running it.

--github-output is for CI: it writes the --grep pattern to $GITHUB_OUTPUT as
grep, empty when the change needs the full suite, instead of running Playwright.`;

function main(args) {
  let base;
  let githubOutput = false;
  const playwrightArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") {
      base = args[++i];
      if (!base) throw new Error("--base needs a revision.");
    } else if (args[i] === "--github-output") githubOutput = true;
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(usage);
      return 0;
    } else playwrightArgs.push(args[i]);
  }
  base ??= git("merge-base", "origin/main", "HEAD").trim();

  const selection = selectSpecs(changedFiles(base));
  console.log(describeSelection(selection, githubOutput));
  const runsFullSuite = githubOutput && selection.fullSuiteReason !== undefined;
  const grep = runsFullSuite ? "" : grepFor(selection.specs.map(({ spec }) => spec));

  if (githubOutput) {
    const file = process.env.GITHUB_OUTPUT;
    if (!file) throw new Error("--github-output needs GITHUB_OUTPUT, which GitHub Actions sets.");
    appendFileSync(file, `grep=${grep}\n`);
    return 0;
  }
  const grepArgs = grep ? ["--grep", grep] : [];
  const result = spawnSync("pnpm", ["exec", "playwright", "test", ...grepArgs, ...playwrightArgs], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (import.meta.main) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
