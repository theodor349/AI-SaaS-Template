import type { ConvexReactClient } from "convex/react";

// A reconnect must stay live this long before it is reported. A resumed tab often
// reconnects with an expired Clerk token, and Convex then drops the socket again to
// fetch a new one; that second gap belongs to the same outage.
const SETTLE_MS = 5_000;
// Convex notices a dead socket after 60 seconds without a server message, so a
// connection that went stale while the page was hidden drops within this window.
const RESUME_WINDOW_MS = 70_000;
// Shorter absences are tab switches rather than a sleeping device.
const MIN_HIDDEN_MS = 10_000;

type Attributes = Record<string, string | number | boolean>;
export type ReportMetric = (name: string, valueMs: number, attributes: Attributes) => void;

type Resume = { visibleAt: number; hiddenMs: number };

type Outage = {
  startedAt: number;
  liveAt?: number;
  closeReason?: string;
  retries: number;
  authWaitMs: number;
  refreshingSince?: number;
  offline: boolean;
  hidden: boolean;
  resume?: Resume;
};

// Measures how long the Convex client stays unable to deliver live data. Feed it the
// client's connection state, `useConvexAuth().isRefreshing`, page visibility, and the
// browser's online flag. It reports:
// - convex.reconnect.duration: from a noticed drop until the socket is connected and
//   authenticated again.
// - convex.reconnect.auth_wait: the part of that outage spent fetching a new token.
// - convex.resume.delay: from the page becoming visible after an absence until data is
//   live again, or 0 when the connection survived the absence.
export function createReconnectTracker(report: ReportMetric) {
  let connected = false;
  let refreshing = false;
  let everLive = false;
  let online = true;
  let hiddenSince: number | undefined;
  let outage: Outage | undefined;
  let resume: Resume | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;

  const activeOutage = () => (outage && outage.liveAt === undefined ? outage : undefined);

  function update() {
    const now = Date.now();
    const live = connected && !refreshing;
    if (!everLive) {
      everLive = live;
      return;
    }
    if (!live) {
      if (!outage) {
        outage = {
          startedAt: now,
          retries: 0,
          authWaitMs: 0,
          offline: !online,
          hidden: hiddenSince !== undefined,
          resume,
        };
      } else if (outage.liveAt !== undefined) {
        outage.liveAt = undefined;
        clearTimeout(settleTimer);
      }
      return;
    }
    if (activeOutage()) {
      outage!.liveAt = now;
      settleTimer = setTimeout(finishOutage, SETTLE_MS);
    }
  }

  function finishOutage() {
    const ended = outage!;
    outage = undefined;
    const liveAt = ended.liveAt!;
    const attributes = {
      closeReason: ended.closeReason ?? "none",
      retries: ended.retries,
      authRefresh: ended.authWaitMs > 0,
      offline: ended.offline,
      hidden: ended.hidden,
      afterResume: ended.resume !== undefined,
    };
    report("convex.reconnect.duration", liveAt - ended.startedAt, attributes);
    if (ended.authWaitMs > 0) report("convex.reconnect.auth_wait", ended.authWaitMs, attributes);
    if (ended.resume) {
      report("convex.resume.delay", liveAt - ended.resume.visibleAt, {
        ...attributes,
        stale: true,
        hiddenFor: hiddenBucket(ended.resume.hiddenMs),
      });
      if (resume === ended.resume) clearResume();
    }
  }

  function clearResume() {
    resume = undefined;
    clearTimeout(resumeTimer);
  }

  return {
    connection(state: { isWebSocketConnected: boolean; connectionRetries: number }) {
      connected = state.isWebSocketConnected;
      update();
      if (outage) outage.retries = Math.max(outage.retries, state.connectionRetries);
    },
    refreshing(value: boolean) {
      refreshing = value;
      update();
      if (!outage) return;
      if (value) outage.refreshingSince ??= Date.now();
      else if (outage.refreshingSince !== undefined) {
        outage.authWaitMs += Date.now() - outage.refreshingSince;
        outage.refreshingSince = undefined;
      }
    },
    closeReason(reason: string) {
      if (outage) outage.closeReason = reason.slice(0, 80);
    },
    online(value: boolean) {
      online = value;
      if (!value && outage) outage.offline = true;
    },
    visibility(visible: boolean) {
      const now = Date.now();
      if (!visible) {
        hiddenSince ??= now;
        if (outage) outage.hidden = true;
        // An unproven resume can't be judged once the page hides again.
        clearResume();
        return;
      }
      if (hiddenSince === undefined) return;
      const hiddenMs = now - hiddenSince;
      hiddenSince = undefined;
      if (hiddenMs < MIN_HIDDEN_MS) return;
      const current: Resume = { visibleAt: now, hiddenMs };
      resume = current;
      const open = activeOutage();
      if (open) open.resume = current;
      resumeTimer = setTimeout(() => {
        resume = undefined;
        // An outage linked to this resume reports the delay when it ends.
        if (outage?.resume === current) return;
        report("convex.resume.delay", 0, { stale: false, hiddenFor: hiddenBucket(hiddenMs) });
      }, RESUME_WINDOW_MS);
    },
    dispose() {
      clearTimeout(settleTimer);
      clearTimeout(resumeTimer);
    },
  };
}

const reasonListeners = new Set<(reason: string) => void>();

// The ConvexReactClient logger. It prints what Convex's default logger prints, and hands
// the close reason from each reconnect line to `onReconnectReason` listeners.
export const convexLogger: ConvexReactClient["logger"] = {
  logVerbose() {},
  log(...args: unknown[]) {
    console.log(...args);
    const reason = reconnectReason(args);
    if (reason) for (const listener of reasonListeners) listener(reason);
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

export function onReconnectReason(listener: (reason: string) => void) {
  reasonListeners.add(listener);
  return () => void reasonListeners.delete(listener);
}

// The Convex client logs ("WebSocket reconnected at", time, "after disconnect due to",
// reason) when a socket reopens. Returns the reason, or undefined for other lines.
export function reconnectReason(args: unknown[]) {
  if (args[0] !== "WebSocket reconnected at" || args[2] !== "after disconnect due to") return undefined;
  return typeof args[3] === "string" ? args[3] : undefined;
}

function hiddenBucket(ms: number) {
  if (ms < 60_000) return "under 1m";
  if (ms < 600_000) return "1-10m";
  if (ms < 3_600_000) return "10-60m";
  return "over 1h";
}
