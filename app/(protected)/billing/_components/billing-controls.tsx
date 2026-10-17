"use client";

import { useQuery } from "convex/react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { ContentSkeleton, TextSkeleton } from "@/components/loading/content-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { planLabels } from "@/convex/billing/plans";
import { useBillingAccount } from "@/components/billing/use-billing-account";
import { useBillingRequests } from "./billing-actions-provider";

const unpaidDescription = "Choose a plan to get Pro access.";

export function BillingControls() {
  return (
    <AuthBoundary pending={<BillingControlsSkeleton />}>
      <BillingControlsContent />
    </AuthBoundary>
  );
}

export function BillingControlsSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Billing status">
      <CardHeader>
        <CardTitle>
          <ContentSkeleton><h2>Choose your paid plan</h2></ContentSkeleton>
        </CardTitle>
        <CardDescription>
          <TextSkeleton>{unpaidDescription}</TextSkeleton>
        </CardDescription>
        <p role="status" className="sr-only">Loading billing status…</p>
      </CardHeader>
    </Card>
  );
}

function BillingControlsContent() {
  const { status, isLoading, isDeleting } = useBillingAccount();
  const { actions, checkout } = useBillingRequests();
  // Reconciliation problems are separate from the entitlement so bookkeeping
  // never re-runs every paid page's status subscription.
  const sync = useQuery(api.billing.account.syncStatus);
  const params = useSearchParams();

  if (isLoading || !status) {
    return <AuthPending fallback={<BillingControlsSkeleton />} />;
  }

  if (status.readiness === "deleting") {
    return (
      <Alert>
        <AlertTitle>Account deletion is being completed</AlertTitle>
        <AlertDescription>
          <NextLink href="/account">View account status</NextLink>
        </AlertDescription>
      </Alert>
    );
  }

  const lifetime = status.state === "active" && status.model === "lifetime";
  let title = "Choose your paid plan";
  let description = unpaidDescription;

  if (status.state === "active" && status.model) {
    title = "Subscription";
    description = "Your paid access is confirmed.";
  } else if (status.state === "ended") {
    title = "Restore Pro access";
  }
  if (lifetime) {
    title = "Lifetime access";
    description = "You have lifetime access.";
  }

  const recurring = status.state === "active" && status.model !== "lifetime";
  const confirmationPending = params.get("confirmation") === "pending" && status.state !== "active";
  const cancellation = status.cancelAtPeriodEnd ? "reactivate" : "cancel";
  const isBusy = actions.isBusy || checkout.isPending;
  const changeDisabled = isBusy || actions.changePending;
  const cancelPending = actions.isPending("cancel") || actions.isPending("reactivate");
  const hasDetails = lifetime || recurring || isDeleting || confirmationPending || sync?.failure || actions.isUnconfirmed;
  const hasActions = status.hasCustomer || (recurring && !isDeleting);
  let dateLabel = status.cancelAtPeriodEnd ? "Access ends" : "Paid through";
  let accessDate = status.paidThrough;
  if (lifetime) {
    dateLabel = "Purchased on";
    accessDate = status.lifetimePurchasedAt;
  }
  const dateValue = accessDate === null ? "Unavailable" : new Date(accessDate).toLocaleDateString(undefined, {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <Card aria-label="Billing status">
      <CardHeader>
        <CardTitle><h2>{title}</h2></CardTitle>
        <CardDescription>
          {description}
        </CardDescription>
      </CardHeader>
      {hasDetails && (
        <CardContent>
          <div className="flex flex-col gap-4">
            {isDeleting && (
              <Alert>
                <AlertTitle>Deletion is scheduled</AlertTitle>
                <AlertDescription>
                  Undo deletion in <NextLink href="/account">Account</NextLink> before resuming your subscription.
                </AlertDescription>
              </Alert>
            )}
            {status.state === "active" && status.model && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="billing-plan">Plan</Label>
                  <Input id="billing-plan" value={planLabels[status.model]} disabled />
                </div>
                {(lifetime || status.paidThrough !== null) && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="billing-paid-through">
                      {dateLabel}
                    </Label>
                    <Input
                      id="billing-paid-through"
                      value={dateValue}
                      disabled
                    />
                  </div>
                )}
              </div>
            )}
            {recurring && (
              <p className="text-muted-foreground">
                {status.cancelAtPeriodEnd
                  ? "Automatic renewal is off. You’ll keep Pro access until your paid period ends."
                  : "Your subscription renews automatically."}
              </p>
            )}
            {recurring && status.scheduledChange && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="billing-next-plan">Next plan</Label>
                <Input
                  id="billing-next-plan"
                  value={`${planLabels[status.scheduledChange.model]} from ${new Date(status.scheduledChange.at).toLocaleDateString(undefined, {
                    day: "numeric", month: "long", year: "numeric",
                  })}`}
                  disabled
                />
              </div>
            )}
            {confirmationPending && (
              <p role="status">
                Payment confirmation pending. We’ll update this page when paid access is confirmed.
              </p>
            )}
            {sync?.failure && (
              <Alert variant={sync.retrying ? "default" : "destructive"}>
                <AlertTitle>{sync.retrying ? "Confirming your billing details" : "We couldn’t update your billing details"}</AlertTitle>
                <AlertDescription>
                  {sync.retrying
                    ? "We’re retrying the update. Your billing details will refresh when confirmed."
                    : "You can review your subscription in the customer portal."}
                </AlertDescription>
              </Alert>
            )}
            {actions.isUnconfirmed && (
              <Alert variant="destructive">
                <AlertTitle>The change is still unconfirmed</AlertTitle>
                <AlertDescription>Review your subscription in the customer portal or retry the change.</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      )}
      {hasActions && (
        <CardFooter>
          <div className="flex flex-wrap gap-3">
            {status.hasCustomer && (
              <Button
                disabled={isBusy}
                variant="outline"
                onClick={() => void actions.run("portal")}
                aria-busy={actions.isPending("portal")}
                aria-live="polite"
              >
                <ButtonLabel loading={actions.isPending("portal")} loadingText="Opening portal…">
                  Customer portal
                </ButtonLabel>
              </Button>
            )}
            {recurring && !isDeleting && (
              <Button
                disabled={changeDisabled}
                variant={status.cancelAtPeriodEnd ? "default" : "destructive"}
                onClick={() => void actions.run(cancellation)}
                aria-busy={cancelPending}
                aria-live="polite"
              >
                <ButtonLabel loading={cancelPending} loadingText="Confirming renewal…">
                  {status.cancelAtPeriodEnd ? "Renew subscription" : "Cancel subscription"}
                </ButtonLabel>
              </Button>
            )}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
