import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { maintenanceMode } from "@/lib/maintenance";
import { noIndex } from "@/lib/seo";
import { MaintenanceNotice } from "../_components/maintenance-notice";
import { SessionEnded } from "./_components/session-ended";

export const metadata: Metadata = { robots: noIndex };

// Every page in this group requires a signed-in user. proxy.ts sends signed-out visitors
// to sign-in, so these pages prerender as static pages: they render no protected data on
// the server, and their components read it from Convex, whose functions check the caller.
// Any page, route handler, or Server Function here that reads protected data on the server
// must call `auth.protect()` itself. Calling it here would make every page dynamic.
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  if (maintenanceMode) return <MaintenanceNotice />;
  // Covers sessions that end while a page is open. Pages keep their shell while auth
  // loads; their components show their own skeletons.
  return (
    <AuthBoundary renderWhilePending signedOut={<SessionEnded />}>
      {children}
    </AuthBoundary>
  );
}
