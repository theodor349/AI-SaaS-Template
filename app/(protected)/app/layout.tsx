import type { ReactNode } from "react";
import { AccountBoundary } from "@/components/auth/account-boundary";
import { AuthBoundary } from "@/components/auth/auth-boundary";
import { PaidBoundary } from "@/components/billing/paid-boundary";
import { billingEnabled } from "@/convex/billing/plans";
import { InstallOffer } from "./_components/install-offer";

// A free app waits only for a ready account, so its loading screen never mentions payment.
const AccessBoundary = billingEnabled ? PaidBoundary : AccountBoundary;

// The access boundary shows the loading screen for both sign-in and the account, so the
// AuthBoundary renders it while auth loads instead of its own pending state.
export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return (
    <AuthBoundary renderWhilePending>
      <AccessBoundary>
        {children}
        <InstallOffer />
      </AccessBoundary>
    </AuthBoundary>
  );
}
