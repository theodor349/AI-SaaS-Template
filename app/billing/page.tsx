import { Suspense } from "react";
import { BillingControls, BillingControlsSkeleton } from "./_components/billing-controls";
import { BillingPlans, BillingPlansSkeleton } from "./_components/billing-plans";
import { BillingActionsProvider } from "./_components/billing-actions-provider";

export default function BillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Billing</h1>
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
