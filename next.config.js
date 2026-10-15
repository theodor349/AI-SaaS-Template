// Bootstrap's local stack reports browser and server Sentry events to the app's own fake
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
  },
}

// Sentry's build plugin uploads source maps for the release, and runs only when
// SENTRY_AUTH_TOKEN is set, as on Vercel. Other builds keep this config unchanged;
// a failed upload warns instead of failing the build.
module.exports = process.env.SENTRY_AUTH_TOKEN
  ? require("@sentry/nextjs/config").withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
    widenClientFileUpload: true,
    // Server requests are not traced, so skip the build-time tracing instrumentation.
    buildTimeInstrumentation: false,
    telemetry: false,
    silent: true,
    errorHandler: (error) => console.warn(`Sentry source map upload failed: ${error.message}`),
  })
  : nextConfig
