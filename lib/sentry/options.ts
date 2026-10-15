import type { init } from "@sentry/nextjs";
import { scrub, scrubBreadcrumb, scrubEvent } from "./scrub";

// Sentry is optional: without a DSN nothing initializes or downloads. next.config.js
// derives the environment from WORKTREE_ID and the release from the Vercel Git SHA,
// and points bootstrap's local stack at a fake ingest route. A DSN that isn't a URL
// turns Sentry off rather than breaking the proxy, which derives the CSP from it.
function validDsn(dsn: string | undefined) {
  if (!dsn) return undefined;
  if (URL.canParse(dsn)) return dsn;
  console.error("NEXT_PUBLIC_SENTRY_DSN is not a valid URL, so Sentry is off.");
  return undefined;
}

export const sentryDsn = validDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

// Options shared by the browser and server SDKs, including the privacy settings: no
// user details, IP addresses, cookies, request bodies, or local variables. Request
// headers are allowlisted because proxies add identifying ones, such as Vercel's
// geolocation. Emails and credentials are scrubbed from everything else.
export const sentryOptions = {
  dsn: sentryDsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: ["host", "user-agent", "accept", "content-type", "referer"] }, response: false },
    httpBodies: [],
    stackFrameVariables: false,
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
  },
  beforeSend: scrubEvent,
  beforeSendSpan: scrub,
  beforeBreadcrumb: scrubBreadcrumb,
} satisfies Parameters<typeof init>[0];
