/// <reference types="vite/client" />
import { expect, test } from "vitest";
import generatedApi from "./_generated/api.d.ts?raw";

// convex/_generated/api.d.ts lists every function module. Only `convex dev`,
// which bootstrap runs, regenerates it; `convex codegen` needs a deployment,
// which CI doesn't have. A module added or removed without regenerating is
// missing from `api` and `internal`, so this fails until bootstrap has run.
const sources = Object.keys(import.meta.glob(["./**/*.ts", "./**/*.js", "!./_generated/**"]));

test("the generated API lists exactly the function modules on disk", () => {
  // Convex skips files whose base name has another dot (tests, fixtures,
  // convex.config, auth.config) and the schema.
  const modules = sources
    .map((path) => path.slice("./".length).replace(/\.[jt]s$/, ""))
    .filter((path) => !path.split("/").at(-1)!.includes(".") && path !== "schema");
  const listed = [...generatedApi.matchAll(/^import type \* as \w+ from "\.\.\/(.+)\.js";$/gm)]
    .map(([, path]) => path);
  expect(listed.sort()).toEqual(modules.sort());
});
