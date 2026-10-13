// @vitest-environment node
import { readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { config } from "./proxy";

test("the proxy matches every route in the protected group", () => {
  const routes = readdirSync(new URL("./app/(protected)", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_(@]/.test(entry.name))
    .map((entry) => `/${entry.name}(.*)`);
  expect(routes.length).toBeGreaterThan(0);
  expect(config.matcher.slice(1)).toEqual(expect.arrayContaining(routes));
});
