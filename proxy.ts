import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAuthPath, safeReturnTo } from "./lib/auth";
import { consentServices } from "./lib/consent/services";
import { contentSecurityPolicyHeaders, sentrySecurityEndpoint } from "./lib/security/csp";
import { sentryDsn } from "./lib/sentry/options";

// Clerk's recommended matcher: pages and API routes, skipping Next internals and static files.
// This proxy never decides access. Each page, layout, route handler, or Server Function
// that reads protected data checks auth itself; Convex functions check their own callers.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};

// Returns the sign-in or sign-up URL without a redirect_url that leaves this application,
// or null when the request needs no change.
export function withoutUnsafeReturnTo(request: Request, appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  // NextURL normalizes loopback hosts to localhost, unlike the raw request URL.
  const requestUrl = new URL(request.url);
  if (!isAuthPath(requestUrl.pathname)) return null;
  // Next reconstructs a proxy request with its loopback listener origin.
  // Restore only the explicitly configured public origin when its Host matches.
  const publicUrl = appUrl ? new URL(appUrl) : null;
  const url = publicUrl && request.headers.get("host") === publicUrl.host
    ? new URL(`${requestUrl.pathname}${requestUrl.search}`, publicUrl.origin)
    : requestUrl;
  const returnTo = url.searchParams.get("redirect_url");
  if (returnTo === null || safeReturnTo(returnTo, url.origin) !== null) return null;
  url.searchParams.delete("redirect_url");
  return url;
}

// Set here rather than in next.config.js so the policy can read the consent registry,
// and per response without making static pages dynamic. CSP_REPORT_ONLY=1 reports
// violations without blocking them, for rolling out a change to the policy.
const securityHeaders = contentSecurityPolicyHeaders({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  development: process.env.NODE_ENV === "development",
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  services: consentServices,
  reportOnly: process.env.CSP_REPORT_ONLY === "1",
  reportUrl: sentryDsn && sentrySecurityEndpoint(sentryDsn, {
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  }),
});

export default clerkMiddleware((_auth, request) => {
  const sanitized = withoutUnsafeReturnTo(request);
  const response = sanitized ? NextResponse.redirect(sanitized) : NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
});
