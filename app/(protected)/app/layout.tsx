import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { PaidBoundary } from "@/components/billing/paid-boundary";

// PaidBoundary queries billing state, so it waits for an authenticated Convex client.
export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <AuthBoundary><PaidBoundary>{children}</PaidBoundary></AuthBoundary>;
}
