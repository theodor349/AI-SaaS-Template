import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { safeReturnTo } from "./lib/auth";

// Public: /, /layouts, /sign-in, /sign-up, and static assets.
// Convex HTTP handlers have their own auth boundary; no Next webhook exception exists.
const isProtectedRoute = createRouteMatcher(["/app(.*)", "/api(.*)", "/trpc(.*)"]);
const isAuthRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isAuthRoute(request)) {
    // NextURL normalizes loopback hosts to localhost, unlike the raw request URL.
    const url = new URL(request.url);
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
    "/(api|trpc)(.*)",
  ],
};
