import { auth } from "@clerk/nextjs/server";
import { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";

import { PaidBoundary } from "@/components/billing/paid-boundary";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  // Keep the server boundary even if a downstream app changes its proxy matcher.
  await auth.protect();
  return <AuthBoundary><PaidBoundary>{children}</PaidBoundary></AuthBoundary>;
}
