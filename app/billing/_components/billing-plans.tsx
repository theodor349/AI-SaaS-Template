"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { Pricing, PricingSkeleton } from "@/components/billing/pricing";
import { useBillingAccount } from "@/components/billing/use-billing-account";
import { useBillingRequests } from "./billing-actions-provider";
import { PlanSwitchConfirmation } from "./plan-switch-confirmation";

type Plan = FunctionArgs<typeof api.polar.checkout>["model"];

export function BillingPlans() {
  return (
    <AuthBoundary pending={<BillingPlansSkeleton />}>
      <BillingPlansContent />
    </AuthBoundary>
  );
}

export function BillingPlansSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Paid plans">
      <PricingSkeleton />
    </div>
  );
}

function BillingPlansContent() {
  const { status, isLoading, isDeleting } = useBillingAccount();
  const { actions, checkout } = useBillingRequests();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("plan");
  const selectedPlan = selected === "monthly" || selected === "yearly" || selected === "lifetime" ? selected : null;
  const startedCheckout = useRef(false);
  const [switchPlan, setSwitchPlan] = useState<"monthly" | "yearly" | null>(null);
  const recurring = status?.state === "active";
  const disabled = actions.isBusy || actions.changePending || checkout.isPending;

  // Resume the plan chosen before sign-in once billing is ready. Consume the
  // selection before checkout so a failed request or reload cannot repeat it.
  useEffect(() => {
    if (!selectedPlan || startedCheckout.current || isLoading || isDeleting ||
      status?.readiness !== "ready" || status.model === "lifetime" || disabled ||
      (recurring && selectedPlan !== "lifetime")) return;

    startedCheckout.current = true;
    router.replace("/billing", { scroll: false });
    void checkout.purchase(selectedPlan);
  }, [selectedPlan, isLoading, isDeleting, status, disabled, recurring, router, checkout]);

  if (isLoading || !status) {
    return <AuthPending fallback={<BillingPlansSkeleton />} />;
  }

  if ((status.state === "active" && status.model === "lifetime") || isDeleting) {
    return null;
  }

  let pendingPlan = checkout.pendingPlan;
  if (actions.isPending("monthly")) pendingPlan = "monthly";
  else if (actions.isPending("yearly")) pendingPlan = "yearly";

  let confirmationPlan = switchPlan;
  if (recurring && (selectedPlan === "monthly" || selectedPlan === "yearly")) {
    confirmationPlan = selectedPlan;
  }
  if (!recurring || status.cancelAtPeriodEnd || confirmationPlan === status.model || confirmationPlan === status.scheduledChange?.model) {
    confirmationPlan = null;
  }

  function selectPlan(model: Plan) {
    if (disabled || (recurring && status.cancelAtPeriodEnd && model !== "lifetime")) return;
    if (recurring && model !== "lifetime") setSwitchPlan(model);
    else void checkout.purchase(model);
  }

  function dismissConfirmation() {
    setSwitchPlan(null);
    if (selectedPlan) router.replace("/billing", { scroll: false });
  }

  function confirmSwitch() {
    if (!confirmationPlan || disabled) return;
    void actions.run(confirmationPlan);
    dismissConfirmation();
  }

  return (
    <div className="flex flex-col gap-6" aria-label="Paid plans">
      <Pricing disabled={disabled} pendingPlan={pendingPlan} onSelect={selectPlan} />
      <PlanSwitchConfirmation
        plan={confirmationPlan}
        disabled={disabled}
        onCancel={dismissConfirmation}
        onConfirm={confirmSwitch}
      />
    </div>
  );
}
