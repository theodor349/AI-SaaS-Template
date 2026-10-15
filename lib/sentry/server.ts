import { init } from "@sentry/nextjs";
import { sentryOptions } from "./options";

// Bootstrap's local DSN points at the fake ingest route, but Next redirects the SDK's
// `/envelope/` URL to `/envelope` and the server transport doesn't follow redirects,
// so the server posts to the route directly over loopback.
function localIngest() {
  if (process.env.E2E_TEST_ROUTES !== "1") return undefined;
  return `http://127.0.0.1:${process.env.PORT}/e2e/sentry/api/1/envelope`;
}

// Loaded by instrumentation.ts in the Node.js and edge runtimes when a DSN is set.
// Errors only: server requests are not traced.
export function startServerSentry() {
  init({ ...sentryOptions, tunnel: localIngest() });
}
