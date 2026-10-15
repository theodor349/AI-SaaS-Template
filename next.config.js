// Bootstrap's local stack reports browser and server Sentry events to the app's own fake
// ingest route (app/e2e/sentry) instead of any configured project, so E2E tests
// can observe them and worktrees never report to a real Sentry project.
function sentryDsn() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.E2E_TEST_ROUTES !== "1" || !appUrl) return process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
  const { protocol, host } = new URL(appUrl);
  return `${protocol}//e2e@${host}/e2e/sentry/1`;
}

// Sent with every response, static files included. The Content Security Policy,
// including frame-ancestors 'none', is set per page in proxy.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // A fallback for browsers that ignore CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Turns off features the app doesn't use. Passkeys and the clipboard keep their defaults.
  {
    key: "Permissions-Policy",
    value: "accelerometer=(), browsing-topics=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), usb=()",
  },
  // Production only: next dev and loopback stacks are plain HTTP. Without
  // includeSubDomains, so an app on an apex domain doesn't force HTTPS on its siblings.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  allowedDevOrigins: process.env.NEXT_PUBLIC_APP_URL
    ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname]
    : [],
  // Preserve 127.0.0.1 in Clerk's internal rewrite when Next binds to loopback.
  skipProxyUrlNormalize: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Inlined into browser code; read through lib/sentry/options.ts.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn(),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.WORKTREE_ID ?? "",
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    // Read by components/pwa/service-worker.tsx so each deploy updates the worker.
    NEXT_PUBLIC_DEPLOYMENT_VERSION: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "",
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
