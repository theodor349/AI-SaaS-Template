import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const guard = fileURLToPath(new URL("./bootstrap-output-guard.mjs", import.meta.url));

for (const stream of ["stdout", "stderr"]) {
  test(`a closed ${stream} pipe exits instead of looping in the exception logger`, { timeout: 5000 }, async () => {
    const child = spawn(process.execPath, ["--import", guard, "-e", `
      process.on("uncaughtException", error => console.error(error));
      process.on("message", () => process.${stream}.write("Subscription action failed\\n"));
      process.send("ready");
    `], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const closed = once(child, "close");
    const deadline = new AbortController();
    try {
      await once(child, "message");
      child[stream].destroy();
      child.send("write");
      const [code] = await Promise.race([
        closed,
        delay(2000, undefined, { signal: deadline.signal }).then(() => {
          throw new Error("Service kept running after its output pipe closed");
        }),
      ]);
      assert.equal(code, 1);
    } finally {
      deadline.abort();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
  });
}

test("a deleted terminal's EIO exits before an uncaught-exception logger can repeat it", async () => {
  const child = spawn(process.execPath, ["--import", guard, "-e", `
    process.on("uncaughtException", () => process.exit(42));
    process.stdout.emit("error", Object.assign(new Error("write EIO"), { code: "EIO" }));
  `], { stdio: "ignore" });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
});
