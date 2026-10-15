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

function sampleRate(value: string | undefined, fallback: number) {
  const rate = Number(value);
  return value && rate >= 0 && rate <= 1 ? rate : fallback;
}

// Options shared by every Sentry SDK in the app, including the privacy settings.
export const sentryOptions = {
  dsn: sentryDsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || undefined,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
  sendDefaultPii: false,
  tracesSampleRate: sampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 1),
  beforeSend: scrubEvent,
  beforeSendSpan: scrub,
  beforeBreadcrumb: scrubBreadcrumb,
};
