import assert from "node:assert/strict";
import test from "node:test";
import { needsDeploy } from "./vercel-ignore-build.mjs";

test("docs, agent files, CI, E2E tests, and dev scripts do not deploy", () => {
  assert.equal(
    needsDeploy([
      "AGENTS.md",
      "docs/deployment.md",
      ".agents/skills/implement/SKILL.md",
      ".claude/settings.json",
      ".github/workflows/ci.yml",
      "tests/e2e/notes.spec.mts",
      "scripts/bootstrap.mjs",
      "scripts/bootstrap/state.mjs",
      "lib/seo.test.ts",
      "components/billing/pricing.test.tsx",
    ]),
    false,
  );
});

test("app code, Convex functions, config, and dependencies deploy", () => {
  for (const file of ["app/page.tsx", "convex/schema.ts", "next.config.js", "vercel.json", "package.json", "pnpm-lock.yaml", "public/logo.png"]) {
    assert.equal(needsDeploy(["docs/deployment.md", file]), true, file);
  }
});

test("rendered Markdown and the script the build runs deploy", () => {
  assert.equal(needsDeploy(["content/legal/terms.md"]), true);
  assert.equal(needsDeploy(["scripts/sync-maintenance-mode.mjs"]), true);
});

// A redeploy diffs a commit against itself.
test("an empty diff deploys", () => {
  assert.equal(needsDeploy([]), true);
});
