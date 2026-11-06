// @vitest-environment happy-dom
import { ClerkOfflineError } from "@clerk/nextjs/errors";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { retryWhileOffline } from "./clerk-token";

// What Clerk throws at runtime: the same error from the clerk-js bundle it loads,
// which isn't an instance of the class @clerk/nextjs exports.
class BundledClerkOfflineError extends Error {
  static kind = "ClerkOfflineError";
  code = "clerk_offline";
}
const offline = () => new BundledClerkOfflineError("Clerk: Network request failed while offline");
let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("waits for the browser to come back online before asking Clerk again", async () => {
  const request = vi.fn<() => Promise<string | null>>()
    .mockRejectedValueOnce(offline())
    .mockResolvedValueOnce("fresh token");
  online = false;
  const token = retryWhileOffline(request);

  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(1);

  online = true;
  window.dispatchEvent(new Event("online"));
  await expect(token).resolves.toBe("fresh token");
  expect(request).toHaveBeenCalledTimes(2);
});

test("keeps retrying after a delay while Clerk fails and the browser reports itself online", async () => {
  const request = vi.fn<() => Promise<string | null>>()
    .mockRejectedValueOnce(offline())
    .mockRejectedValueOnce(new ClerkOfflineError("Clerk: Network request failed while offline"))
    .mockResolvedValueOnce("fresh token");
  const token = retryWhileOffline(request, 1_000);

  await vi.advanceTimersByTimeAsync(999);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1_000);
  await expect(token).resolves.toBe("fresh token");
  expect(request).toHaveBeenCalledTimes(3);
});

test("passes other failures and a signed-out result through without retrying", async () => {
  const signedOut = vi.fn(async () => null);
  await expect(retryWhileOffline(signedOut)).resolves.toBeNull();

  const failure = new Error("Clerk rejected the request");
  const rejected = vi.fn(async () => { throw failure; });
  await expect(retryWhileOffline(rejected)).rejects.toBe(failure);
  expect(rejected).toHaveBeenCalledTimes(1);
});
