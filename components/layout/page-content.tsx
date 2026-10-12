"use client";

import { usePathname } from "next/navigation";
import { AuthBoundary } from "@/components/auth/auth-boundary";

// Public pages, including policy templates, must remain available after sign-out.
export function PageContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const protectedPage = ["/account", "/billing", "/app"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (protectedPage) {
    return (
      <AuthBoundary renderWhilePending signedOut={<p>Your session has ended. Sign in to continue.</p>}>
        {children}
      </AuthBoundary>
    );
  }
  return children;
}
