"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { Pricing, PricingSkeleton } from "@/components/billing/pricing";
import { useBillingAccount } from "@/components/billing/use-billing-account";
import { isRecurringModel, type RecurringModel } from "@/convex/billing/plans";
import { LegalAcceptanceDialog, useLegalAcceptance } from "../../_components/legal-acceptance";
import type { CheckoutPlan } from "../../_components/use-checkout";
import { useBillingRequests } from "./billing-actions-provider";
import { PlanSwitchConfirmation } from "./plan-switch-confirmation";

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
  // Links from pricing and checkout ask subscribers to confirm a recurring plan
  // switch here. Starting checkout from a URL belongs to /checkout.
  const selected = params.get("plan");
  const selectedPlan = isRecurringModel(selected) ? selected : null;
  const [switchPlan, setSwitchPlan] = useState<RecurringModel | null>(null);
  // A purchase waiting for the user to accept the current terms.
  const [acceptancePlan, setAcceptancePlan] = useState<CheckoutPlan | null>(null);
  const legal = useLegalAcceptance();
  const recurring = status?.state === "active";
  const disabled = actions.isBusy || actions.changePending || checkout.isPending;

  if (isLoading || !status) {
    return <AuthPending fallback={<BillingPlansSkeleton />} />;
  }

  if ((status.state === "active" && status.model === "lifetime") || isDeleting) {
    return null;
  }

  let pendingPlan = checkout.pendingPlan;
  if (actions.isPending("monthly")) pendingPlan = "monthly";
  else if (actions.isPending("yearly")) pendingPlan = "yearly";
  else if (actions.isPending("reactivate")) pendingPlan = status.model;

  let confirmationPlan = switchPlan;
  if (recurring && selectedPlan) {
    confirmationPlan = selectedPlan;
  }
  if (!recurring || status.cancelAtPeriodEnd || confirmationPlan === status.model || confirmationPlan === status.scheduledChange?.model) {
    confirmationPlan = null;
  }

  function selectPlan(model: CheckoutPlan) {
    if (disabled) return;
    if (recurring && status.cancelAtPeriodEnd && model === status.model) {
      void actions.run("reactivate");
      return;
    }
    if (recurring && status.cancelAtPeriodEnd && model !== "lifetime") return;
    if (recurring && model !== "lifetime") {
      setSwitchPlan(model);
      return;
    }
    if (legal.required) {
      setAcceptancePlan(model);
      return;
    }
    toast.dismiss("billing-request-error");
    void checkout.start(model);
  }

  function continueAfterAcceptance() {
    if (!acceptancePlan) return;
    setAcceptancePlan(null);
    toast.dismiss("billing-request-error");
    void checkout.start(acceptancePlan);
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
      <LegalAcceptanceDialog
        open={acceptancePlan !== null}
        onOpenChange={(open) => { if (!open) setAcceptancePlan(null); }}
        onAccepted={continueAfterAcceptance}
      />
    </div>
  );
}
