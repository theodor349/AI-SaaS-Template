// Bootstrap's local stack reports browser Sentry events to the app's own fake
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
  },
}

module.exports = nextConfig
