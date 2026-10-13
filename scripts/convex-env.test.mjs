import assert from "node:assert/strict";
import test from "node:test";
import { appEnv } from "../convex/lib/appEnv.ts";
import { backendEnvKeys } from "./bootstrap.mjs";

test("bootstrap pushes exactly the env keys the Convex app declares", () => {
  assert.deepEqual([...backendEnvKeys].sort(), Object.keys(appEnv).sort());
});
