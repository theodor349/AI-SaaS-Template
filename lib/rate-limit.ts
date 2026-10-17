import { retryAfter } from "@/convex/lib/errors";

// Tells the user when a RATE_LIMITED call can succeed, or null for any other
// error, so each caller keeps its own message for those.
export function rateLimitMessage(error: unknown) {
  const wait = retryAfter(error);
  if (wait === null) return null;
  const minutes = Math.max(1, Math.ceil(wait / 60_000));
  return minutes === 1
    ? "Too many attempts. Please wait a minute before trying again."
    : `Too many attempts. Please wait ${minutes} minutes before trying again.`;
}
