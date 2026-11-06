"use client";

import { useAuth, SignInButton } from "@clerk/nextjs";
import { useConvexAuth } from "convex/react";
import { ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";

export function AuthRecovery() {
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn’t load your account</AlertTitle>
      <AlertDescription>
        <p>Try again, or sign out and sign back in.</p>
        <div className="flex gap-4">
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// The timeout changes only the recovery UI; it never redirects or declares sign-out.
export function AuthPending({
  message = "Connecting your account…",
  fallback,
}: {
  message?: string;
  fallback?: ReactNode;
}) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 15_000);
    return () => clearTimeout(timer);
  }, []);
  if (timedOut) {
    return <AuthRecovery />;
  }

  return fallback ?? <p role="status">{message}</p>;
}

// Authentication alone admits checkout, billing recovery, and account controls.
// Place paid feature gates below this boundary; sign-in never grants an entitlement.
export function AuthBoundary({
  children,
  signedOut,
  pending,
  renderWhilePending = false,
}: {
  children: ReactNode;
  signedOut?: ReactNode;
  pending?: ReactNode;
  renderWhilePending?: boolean;
}) {
  const clerk = useAuth();
  const convex = useConvexAuth();
  if (!clerk.isLoaded) {
    return renderWhilePending ? children : <AuthPending fallback={pending} />;
  }
  if (!clerk.isSignedIn) {
    return signedOut ?? (
      <div className="flex flex-col gap-4">
        <p>Your session has ended. Sign in to continue.</p>
        <SignInButton fallbackRedirectUrl={AUTHENTICATED_DESTINATION}>
          <Button>Sign in</Button>
        </SignInButton>
      </div>
    );
  }
  // Only the first load or a new identity waits here. When Convex replaces an
  // expired token after a resume or reconnect, `isRefreshing` stays true while
  // the client keeps its last query results and holds mutations until the new
  // token is accepted, so children stay mounted and keep their state.
  if (convex.isLoading) {
    return renderWhilePending ? children : <AuthPending fallback={pending} />;
  }
  if (!convex.isAuthenticated) return <AuthRecovery />;
  return children;
}
