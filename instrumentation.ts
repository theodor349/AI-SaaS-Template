import type { Instrumentation } from "next";
import { sentryDsn } from "@/lib/sentry/options";

// Server-side Sentry for the Node.js and edge runtimes. Errors from server components,
// route handlers, Server Functions, and proxy.ts reach onRequestError. Without a DSN
// the SDK never loads. Browser Sentry waits for analytics consent; see
// docs/internals/consent.md.
export async function register() {
  if (!sentryDsn) return;
  (await import("@/lib/sentry/server")).startServerSentry();
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!sentryDsn) return;
  (await import("@sentry/nextjs")).captureRequestError(...args);
};
