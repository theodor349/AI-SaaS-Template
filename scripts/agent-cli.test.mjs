import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appLocation, isInside, isLoopbackUrl, parseDuration } from "./agent-cli.mjs";

test("durations need a whole number and a unit", () => {
  assert.equal(parseDuration("0s", "--older-than"), 0);
  assert.equal(parseDuration("15m", "--expires"), 900_000);
  assert.equal(parseDuration("7d", "--older-than"), 604_800_000);
  for (const value of ["2", "1.5h", "-1h", "h", "2 h", "1w", undefined]) {
    assert.throws(() => parseDuration(value, "--older-than"), /--older-than must be/);
  }
});

test("application locations stay on the application's origin", () => {
  const app = "https://agent.example.ts.net:12345";
  assert.equal(appLocation(app, "/billing?plan=yearly#plans").href, `${app}/billing?plan=yearly#plans`);
  for (const path of ["//evil.example/billing", "https://evil.example/", "billing", "/\\evil.example", "/a b", "", undefined]) {
    assert.throws(() => appLocation(app, path), /Expected an application path/);
  }
});

test("loopback app URLs are recognized so remote reviewers get a warning", () => {
  for (const url of ["http://127.0.0.1:3000", "http://localhost:3000", "http://app.localhost", "http://[::1]:3000"]) {
    assert.equal(isLoopbackUrl(url), true, url);
  }
  assert.equal(isLoopbackUrl("https://agent.example.ts.net:12345"), false);
});

test("checkout containment follows symlinks and ignores sibling name prefixes", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "agent cli ")));
  try {
    const root = join(base, "repo");
    mkdirSync(join(root, "app"), { recursive: true });
    mkdirSync(join(base, "repo-other"));
    symlinkSync(join(root, "app"), join(base, "linked"));
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(join(root, "missing/evidence"), root), true);
    assert.equal(isInside(join(base, "linked/evidence"), root), true);
    assert.equal(isInside(join(base, "repo-other/evidence"), root), false);
    assert.equal(isInside(base, root), false);
    assert.equal(isInside(join(root, "../outside"), root), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
