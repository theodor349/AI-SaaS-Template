import { Suspense } from "react";
import { BackLink } from "@/components/layout/back-link";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";
import { BillingControls, BillingControlsSkeleton } from "./_components/billing-controls";
import { BillingPlans, BillingPlansSkeleton } from "./_components/billing-plans";
import { BillingActionsProvider } from "./_components/billing-actions-provider";

export default function BillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <BackLink href={AUTHENTICATED_DESTINATION} label="Dashboard" />
        <h1 className="text-3xl font-bold">Billing</h1>
      </header>
      <BillingActionsProvider>
        <Suspense fallback={<BillingControlsSkeleton />}>
          <BillingControls />
        </Suspense>
        <Suspense fallback={<BillingPlansSkeleton />}>
          <BillingPlans />
        </Suspense>
      </BillingActionsProvider>
    </div>
  );
}
