"use client";

import { usePathname } from "next/navigation";
import { AuthBoundary } from "@/components/auth/auth-boundary";

// Public pages, including policy templates, must remain available after sign-out.
export function PageContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return children;
  const protectedPage = ["/account", "/billing", "/checkout", "/app"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (protectedPage) {
    return (
      <div className="mx-auto max-w-3xl">
        <AuthBoundary renderWhilePending signedOut={<p>Your session has ended. Sign in to continue.</p>}>
          {children}
        </AuthBoundary>
      </div>
    );
  }
  return <div className="mx-auto max-w-3xl">{children}</div>;
}
