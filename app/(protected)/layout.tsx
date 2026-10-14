import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";

// Every page in this group requires a signed-in user. Each top-level folder
// here needs a matching prefix in the proxy matcher; proxy.test.ts checks this.
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  // Keep the server boundary even if a downstream app changes its proxy matcher.
  await auth.protect();
  // Pages keep their shell while auth loads; their components show their own skeletons.
  return (
    <AuthBoundary renderWhilePending signedOut={<p>Your session has ended. Sign in to continue.</p>}>
      {children}
    </AuthBoundary>
  );
}
