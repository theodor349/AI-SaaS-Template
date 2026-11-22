import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createReconnectTracker, reconnectReason } from "./convex-reconnect";

let reports: { name: string; valueMs: number; attributes: Record<string, unknown> }[];
let tracker: ReturnType<typeof createReconnectTracker>;

beforeEach(() => {
  vi.useFakeTimers();
  reports = [];
  tracker = createReconnectTracker((name, valueMs, attributes) => reports.push({ name, valueMs, attributes }));
  tracker.connection({ isWebSocketConnected: true, connectionRetries: 0 });
});

afterEach(() => {
  tracker.dispose();
  vi.useRealTimers();
});

const connected = (retries = 0) => tracker.connection({ isWebSocketConnected: true, connectionRetries: retries });
const disconnected = (retries = 0) => tracker.connection({ isWebSocketConnected: false, connectionRetries: retries });

test("reports an outage once the reconnect has stayed live", () => {
  disconnected();
  vi.advanceTimersByTime(3_000);
  disconnected(2);
  vi.advanceTimersByTime(9_000);
  tracker.closeReason("InactiveServer");
  connected(2);
  vi.advanceTimersByTime(4_999);
  expect(reports).toEqual([]);

  vi.advanceTimersByTime(1);
  expect(reports).toEqual([
    {
      name: "convex.reconnect.duration",
      valueMs: 12_000,
      attributes: expect.objectContaining({ closeReason: "InactiveServer", retries: 2, authRefresh: false }),
    },
  ]);
});

test("does not report the first connection", () => {
  tracker = createReconnectTracker((name, valueMs, attributes) => reports.push({ name, valueMs, attributes }));
  disconnected();
  vi.advanceTimersByTime(2_000);
  connected();
  vi.advanceTimersByTime(10_000);
  expect(reports).toEqual([]);
});

test("counts a token refresh right after reconnecting as part of the same outage", () => {
  disconnected();
  vi.advanceTimersByTime(4_000);
  connected();
  vi.advanceTimersByTime(200);
  // The server rejects the expired token, so Convex stops the socket to fetch a new one.
  tracker.refreshing(true);
  disconnected();
  vi.advanceTimersByTime(15_000);
  connected();
  vi.advanceTimersByTime(300);
  tracker.refreshing(false);
  vi.advanceTimersByTime(5_000);

  expect(reports.map(({ name, valueMs }) => [name, valueMs])).toEqual([
    ["convex.reconnect.duration", 19_500],
    ["convex.reconnect.auth_wait", 15_300],
  ]);
  expect(reports[0].attributes).toMatchObject({ authRefresh: true });
});

test("measures a stale connection from the moment the page becomes visible", () => {
  tracker.visibility(false);
  vi.advanceTimersByTime(5 * 60_000);
  tracker.visibility(true);
  // The socket died during sleep; Convex only notices when its inactivity timer fires.
  vi.advanceTimersByTime(60_000);
  disconnected();
  vi.advanceTimersByTime(2_000);
  connected();
  vi.advanceTimersByTime(5_000);

  expect(reports).toEqual([
    expect.objectContaining({ name: "convex.reconnect.duration", valueMs: 2_000, attributes: expect.objectContaining({ afterResume: true }) }),
    expect.objectContaining({ name: "convex.resume.delay", valueMs: 62_000, attributes: expect.objectContaining({ stale: true, hiddenFor: "1-10m" }) }),
  ]);
  vi.advanceTimersByTime(60_000);
  expect(reports).toHaveLength(2);
});

test("measures an outage that began while the page was hidden from the return", () => {
  tracker.visibility(false);
  vi.advanceTimersByTime(30_000);
  disconnected();
  vi.advanceTimersByTime(30 * 60_000);
  tracker.visibility(true);
  vi.advanceTimersByTime(8_000);
  connected();
  vi.advanceTimersByTime(5_000);

  expect(reports.find(({ name }) => name === "convex.resume.delay")).toMatchObject({
    valueMs: 8_000,
    attributes: { stale: true, hidden: true, hiddenFor: "10-60m" },
  });
});

test("reports a zero delay when the connection survived the absence", () => {
  tracker.visibility(false);
  vi.advanceTimersByTime(2 * 60 * 60_000);
  tracker.visibility(true);
  vi.advanceTimersByTime(70_000);

  expect(reports).toEqual([{ name: "convex.resume.delay", valueMs: 0, attributes: { stale: false, hiddenFor: "over 1h" } }]);
});

test("ignores short tab switches", () => {
  tracker.visibility(false);
  vi.advanceTimersByTime(5_000);
  tracker.visibility(true);
  vi.advanceTimersByTime(70_000);
  expect(reports).toEqual([]);
});

test("reads the close reason from the Convex reconnect log line", () => {
  expect(reconnectReason(["WebSocket reconnected at", "t=12.3s", "after disconnect due to", "InactiveServer"])).toBe("InactiveServer");
  expect(reconnectReason(["WebSocket reconnected at", "t=12.3s"])).toBeUndefined();
  expect(reconnectReason(["Attempting reconnect in 900ms"])).toBeUndefined();
});
