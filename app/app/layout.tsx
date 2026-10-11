import { auth } from "@clerk/nextjs/server";
import { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";

import { AccountControls } from "@/components/auth/account-controls";
import { PaidBoundary } from "@/components/billing/paid-boundary";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  // Keep the server boundary even if a downstream app changes its proxy matcher.
  await auth.protect();
  return (
    <main className="container mx-auto px-4 max-w-2xl py-8">
      <AccountControls /><AuthBoundary><PaidBoundary>{children}</PaidBoundary></AuthBoundary>
    </main>
  );
}
