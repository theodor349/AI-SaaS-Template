import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { grepFor, selectSpecs } from "./e2e-affected.mjs";

const specNames = (files) => {
  const selection = selectSpecs(files);
  assert.equal(selection.fullSuiteReason, undefined);
  return selection.specs.map(({ spec }) => spec);
};

test("a changed spec runs that spec", () => {
  assert.deepEqual(specNames(["tests/e2e/notes.spec.mts"]), ["notes.spec.mts"]);
});

test("mapped files run every spec of their areas, once", () => {
  assert.deepEqual(specNames(["app/(protected)/billing/page.tsx"]), [
    "billing-loading.spec.mts",
    "billing.spec.mts",
    "landing.spec.mts",
    "withdrawal.spec.mts",
  ]);
  assert.deepEqual(specNames(["convex/notes/notes.ts", "app/(protected)/app/_components/note-card.tsx", "tests/e2e/notes.spec.mts"]), [
    "app.spec.mts",
    "notes.spec.mts",
  ]);
  // In two areas: the legal pages and consent.
  assert.deepEqual(specNames(["app/(legal)/_components/cookie-preferences-button.tsx"]), [
    "consent.spec.mts",
    "legal.spec.mts",
    "security-headers.spec.mts",
    "server-errors.spec.mts",
  ]);
});

test("docs, agent files, and unit tests add nothing beyond @critical", () => {
  assert.deepEqual(
    specNames([
      "README.md",
      "AGENTS.md",
      "docs/deployment.md",
      ".agents/skills/complete-worktree/SKILL.md",
      ".claude/skills/implement",
      "app/(protected)/billing/page.test.tsx",
      "convex/notes/notes.test.ts",
      "scripts/bootstrap.test.mjs",
      "tests/integration/polar-webhooks.test.mjs",
    ]),
    [],
  );
});

test("an empty diff runs @critical only", () => {
  assert.deepEqual(specNames([]), []);
});

// The legal pages render these, unlike Markdown at the root or in docs/.
test("rendered Markdown runs its pages' specs", () => {
  assert.deepEqual(specNames(["content/legal/terms.md"]), ["consent.spec.mts", "legal.spec.mts"]);
});

// A local run leaves the full suite to CI and runs the specs the other files map to.
test("shared files run the full suite, and the other files still map to specs", () => {
  for (const file of [
    ".github/workflows/e2e.yml",
    "package.json",
    "pnpm-lock.yaml",
    "playwright.config.mts",
    "tests/e2e/checkout.mts",
    "tests/e2e/global-setup.mts",
    "scripts/bootstrap.mjs",
    "scripts/bootstrap/state.mjs",
    "app/layout.tsx",
    "app/(protected)/layout.tsx",
    "components/auth/auth-boundary.tsx",
    "components/consent/consent-provider.tsx",
    "convex/schema.ts",
    "convex/billing/entitlement.ts",
    "proxy.ts",
  ]) {
    const selection = selectSpecs(["docs/deployment.md", file, "tests/e2e/notes.spec.mts"]);
    assert.deepEqual(selection, { fullSuiteReason: `${file} is a shared file`, specs: [{ spec: "notes.spec.mts", file: "tests/e2e/notes.spec.mts" }] }, file);
  }
});

test("runtime code that no rule maps runs the full suite", () => {
  for (const file of ["components/ui/button.tsx", "convex/lib/retry.ts", "convex/account/users.ts", "lib/utils.tsx", "app/robots.ts", "public/sw.js"]) {
    assert.deepEqual(selectSpecs([file]), { fullSuiteReason: `no rule maps ${file}`, specs: [] }, file);
  }
});

test("the grep selects @critical tests and whole spec files, not specs with a longer name", () => {
  const grep = new RegExp(grepFor(["billing.spec.mts", "export.spec.mts"]));
  // Playwright's string: the project, file, titles, and tags joined by spaces.
  assert.match(" polar billing.spec.mts yearly-to-monthly requires confirmation", grep);
  assert.match(" parallel notes.spec.mts a Pro user creates notes @critical", grep);
  assert.doesNotMatch(" polar billing-loading.spec.mts billing remains visible", grep);
  assert.doesNotMatch(" parallel data-export.spec.mts users download their data", grep);
  assert.equal(grepFor([]), "@critical");
});

test("the map names only existing specs and gives every spec an area", () => {
  const map = JSON.parse(readFileSync(new URL("../tests/e2e/spec-map.json", import.meta.url), "utf8"));
  const specs = readdirSync(new URL("../tests/e2e/", import.meta.url)).filter((name) => name.endsWith(".spec.mts"));
  const mapped = new Set(map.areas.flatMap((area) => area.specs));
  assert.deepEqual([...mapped].filter((spec) => !specs.includes(spec)), [], "the map names specs that do not exist");
  assert.deepEqual(specs.filter((spec) => !mapped.has(spec)), [], "specs without an area in tests/e2e/spec-map.json");
});
