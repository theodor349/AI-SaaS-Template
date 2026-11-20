import { readFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

// Stacks and test runs in parallel worktrees share the machine. bootstrap and the
// heavy test commands wait until the one minute load is at most twice the CPU
// count and at least 3 GiB of memory is available, and give up after 15 minutes.
export const headroomLimits = { loadPerCpu: 2, availableBytes: 3 * 1024 ** 3, timeoutMs: 15 * 60_000 };

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

// CI runners are sized for their jobs, and SKIP_HEADROOM_CHECK=1 lets a maintainer
// start a run on a busy machine on purpose.
export function headroomSkipReason(env = process.env) {
  const set = (value) => Boolean(value) && !["0", "false"].includes(value.toLowerCase());
  if (set(env.SKIP_HEADROOM_CHECK)) return "SKIP_HEADROOM_CHECK is set";
  if (set(env.CI)) return "CI is set";
  return undefined;
}

// MemAvailable counts reclaimable page cache, like the available column of free.
// Other systems report only free pages, which would block every run, so there
// the check uses the load alone.
export function readMachine({ platform = process.platform, meminfo = () => readFileSync("/proc/meminfo", "utf8") } = {}) {
  const machine = { load: loadavg()[0], cpus: availableParallelism() };
  if (platform !== "linux") return machine;
  const kilobytes = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(meminfo())?.[1]);
  return Number.isFinite(kilobytes) ? { ...machine, availableBytes: kilobytes * 1024 } : machine;
}

// Describes why the machine lacks headroom, or returns undefined when it has it.
export function headroomProblem({ load, cpus, availableBytes }, limits = headroomLimits) {
  const problems = [];
  const maxLoad = cpus * limits.loadPerCpu;
  if (load > maxLoad) problems.push(`load ${load.toFixed(1)} is above ${maxLoad} (twice the ${cpus} CPUs)`);
  if (availableBytes !== undefined && availableBytes < limits.availableBytes) {
    problems.push(`${gib(availableBytes)} of memory is available, under ${gib(limits.availableBytes)}`);
  }
  return problems.length ? problems.join(" and ") : undefined;
}

// Resolves once the machine has headroom. onWait(reason, { since, giveUpAt }) runs
// when waiting starts and once a minute after, so the caller can say why nothing
// happens. Throws after timeoutMs, or with signal's reason when it aborts.
export async function waitForHeadroom({
  label, signal, onWait, read = readMachine, env = process.env, limits = headroomLimits,
  intervalMs = 15_000, reportEveryMs = 60_000, now = Date.now, sleep = (ms) => delay(ms, undefined, { signal }).catch(() => {}),
} = {}) {
  if (headroomSkipReason(env)) return;
  const since = now();
  const giveUpAt = since + limits.timeoutMs;
  let reportedAt;
  for (;;) {
    signal?.throwIfAborted();
    const problem = headroomProblem(read(), limits);
    if (!problem) return;
    if (now() >= giveUpAt) {
      throw new Error(`${label} gave up after ${limits.timeoutMs / 60_000} minutes without machine headroom: ${problem}. ` +
        "Wait for other stacks or test runs to finish, or set SKIP_HEADROOM_CHECK=1 to start anyway.");
    }
    if (reportedAt === undefined || now() - reportedAt >= reportEveryMs) {
      reportedAt = now();
      onWait?.(problem, { since: new Date(since).toISOString(), giveUpAt: new Date(giveUpAt).toISOString() });
    }
    await sleep(intervalMs);
  }
}

// The line a waiting command prints, so its output says why nothing happens.
export function describeWait(label, problem, { giveUpAt }) {
  return `${label} is waiting for machine headroom: ${problem}. It starts once the load and memory allow, ` +
    `and gives up at ${giveUpAt}. Set SKIP_HEADROOM_CHECK=1 to start anyway.`;
}
