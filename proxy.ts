import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { safeReturnTo } from "./lib/auth";

// Public: /, /layouts, /sign-in, /sign-up, and static assets.
// Convex HTTP handlers have their own auth boundary; no Next webhook exception exists.
const isProtectedRoute = createRouteMatcher(["/account(.*)", "/billing(.*)", "/app(.*)", "/api(.*)", "/trpc(.*)"]);
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isAuthRoute(request)) {
    // NextURL normalizes loopback hosts to localhost, unlike the raw request URL.
    const url = new URL(request.url);
    // Next reconstructs a proxy request with its loopback listener origin.
    // Restore only the explicitly configured public origin when its Host matches.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : null;
    if (appUrl && request.headers.get("host") === appUrl.host) {
      url.host = appUrl.host;
      url.protocol = appUrl.protocol;
    }
    const returnTo = url.searchParams.get("redirect_url");
    if (returnTo !== null && safeReturnTo(returnTo, url.origin) === null) {
      url.searchParams.delete("redirect_url");
      return NextResponse.redirect(url);
    }
  }
  if (isProtectedRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js|json|txt|xml|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/app(.*)",
    "/billing(.*)",
    "/account(.*)",
    "/(api|trpc)(.*)",
  ],
};
