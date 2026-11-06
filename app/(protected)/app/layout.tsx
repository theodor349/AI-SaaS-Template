import type { ReactNode } from "react";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { PaidBoundary } from "@/components/billing/paid-boundary";
import { InstallOffer } from "./_components/install-offer";

// PaidBoundary shows the loading screen for both sign-in and billing, so the
// AuthBoundary renders it while auth loads instead of its own pending state.
export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return (
    <AuthBoundary renderWhilePending>
      <PaidBoundary>
        {children}
        <InstallOffer />
      </PaidBoundary>
    </AuthBoundary>
  );
}
