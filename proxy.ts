import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isAuthPath, isSignedInPath, safeReturnTo, SIGN_IN_PATH, SIGN_UP_PATH } from "./lib/auth";
import { consentServices } from "./lib/consent/services";
import { contentSecurityPolicyHeaders, sentrySecurityEndpoint } from "./lib/security/csp";
import { maintenanceMode } from "./lib/maintenance";
import { sentryDsn } from "./lib/sentry/options";

// Clerk's recommended matcher: pages and API routes, skipping Next internals and static files.
// The proxy's sign-in redirect is navigation, not access control. Convex functions check
// their own callers, and any page, route handler, or Server Function that reads protected
// data on the server calls `auth.protect()` itself. Pages in app/(protected) read nothing
// protected on the server, so they prerender as static pages.
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

// Next doesn't support URL-encoded server actions and renders its not-found tree for them,
// which has no root layout and throws without ClerkProvider. Real clients never send them,
// so answer like Next does for an unknown action. Scanners probe with these requests.
function isUrlEncodedServerAction(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return request.method === "POST" && request.headers.has("next-action")
    && mediaType === "application/x-www-form-urlencoded";
}

const serverActionNotFound = () => new NextResponse("Server action not found.", {
  status: 404,
  headers: { "content-type": "text/plain", "x-nextjs-action-not-found": "1" },
});

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

// Server-side redirects, such as auth.protect() for a signed-out visitor, read these
// paths. Without them Clerk sends visitors to its hosted Account Portal on accounts.<domain>.
export const clerkOptions = { signInUrl: SIGN_IN_PATH, signUpUrl: SIGN_UP_PATH };

const clerk = clerkMiddleware(async (auth, request) => {
  if (isUrlEncodedServerAction(request)) return serverActionNotFound();
  // Sends a signed-out visitor to sign-in with a return-to URL before the page loads.
  // A route missing from SIGNED_IN_ROUTES shows the layout's AuthBoundary prompt instead.
  // During maintenance the pages show the notice, and sign-in is paused too.
  if (!maintenanceMode && isSignedInPath(request.nextUrl.pathname)) await auth.protect();
  const sanitized = withoutUnsafeReturnTo(request);
  return sanitized ? NextResponse.redirect(sanitized) : undefined;
}, clerkOptions);

// Clerk turns auth.protect() and its session handshake into redirects of its own, which
// get the headers here too.
export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = (await clerk(request, event)) ?? NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}
