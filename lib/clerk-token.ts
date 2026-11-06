import { ClerkOfflineError } from "@clerk/nextjs/errors";

// Repeats a Clerk token request that failed because Clerk couldn't reach its
// Frontend API, so a device that lost its network keeps its session. Clerk backs
// off for about 15 seconds before it throws ClerkOfflineError, and it throws it even
// while `navigator.onLine` is true. While the browser reports itself offline, the
// next attempt waits for its `online` event instead of a timer. Other errors and
// results, including a signed-out `null`, pass through unchanged.
export async function retryWhileOffline<T>(request: () => Promise<T>, retryDelayMs = 2_000): Promise<T> {
  for (;;) {
    try {
      return await request();
    } catch (error) {
      if (!isClerkOffline(error)) throw error;
    }
    await new Promise<void>((resolve) => {
      if (navigator.onLine) setTimeout(resolve, retryDelayMs);
      else window.addEventListener("online", () => resolve(), { once: true });
    });
  }
}

// ClerkOfflineError.is misses the errors Clerk actually throws: they come from the
// clerk-js bundle Clerk loads at runtime, so they fail its instanceof and kind checks.
function isClerkOffline(error: unknown) {
  return error instanceof Error && "code" in error && error.code === ClerkOfflineError.ERROR_CODE;
}
