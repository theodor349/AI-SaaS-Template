import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { noIndex } from "@/lib/seo";

export const metadata: Metadata = { robots: noIndex };

// Every page in this group requires a signed-in user. Pages here render no protected
// data on the server; their components read it from Convex, whose functions check the
// caller. Any page, route handler, or Server Function that reads protected data on the
// server must call `auth.protect()` itself, because this layout does not re-run on
// navigation between its pages.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  // Sends signed-out visitors to sign-in with a return-to URL.
  await auth.protect();
  // Covers sessions that end while a page is open. Pages keep their shell while auth
  // loads; their components show their own skeletons.
  return (
    <AuthBoundary renderWhilePending signedOut={<p>Your session has ended. Sign in to continue.</p>}>
      {children}
    </AuthBoundary>
  );
}
