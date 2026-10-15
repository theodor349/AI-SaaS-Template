// Bootstrap's local stack reports browser Sentry events to the app's own fake
// ingest route (app/e2e/sentry) instead of any configured project, so E2E tests
// can observe them and worktrees never report to a real Sentry project.
function sentryDsn() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.E2E_TEST_ROUTES !== "1" || !appUrl) return process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
  const { protocol, host } = new URL(appUrl);
  return `${protocol}//e2e@${host}/e2e/sentry/1`;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  allowedDevOrigins: process.env.NEXT_PUBLIC_APP_URL
    ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname]
    : [],
  // Preserve 127.0.0.1 in Clerk's internal rewrite when Next binds to loopback.
  skipProxyUrlNormalize: true,
  // Inlined into browser code; read through lib/sentry/options.ts.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn(),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.WORKTREE_ID ?? "",
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    // Read by components/pwa/service-worker.tsx so each deploy updates the worker.
    NEXT_PUBLIC_DEPLOYMENT_VERSION: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
}

module.exports = nextConfig
