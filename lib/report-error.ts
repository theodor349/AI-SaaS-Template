import { activeBrowserSentry } from "@/lib/sentry/active";

// Every error boundary calls this once for each error it catches. Errors with a
// digest came from the server, where server-side instrumentation reports them;
// client errors go to Sentry only while analytics consent has it running.
export function reportError(error: Error & { digest?: string }) {
  if (error.digest) return;
  activeBrowserSentry()?.captureException(error);
}
