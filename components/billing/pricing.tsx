"use client";

import NextLink from "next/link";
import { useId } from "react";
import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { billingModels } from "@/convex/billing/plans";
import { AuthPending, AuthRecovery } from "@/components/auth/auth-boundary";
import { ContentSkeleton } from "@/components/loading/content-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button, ButtonLabel } from "@/components/ui/button";
import { SIGN_UP_PATH } from "@/lib/auth";

const labels = { monthly: "Monthly", yearly: "Yearly", lifetime: "Lifetime" };
const intervals = { monthly: " / month", yearly: " / year", lifetime: " once" };
type Product = FunctionReturnType<typeof api.billing.catalog.products>[number];
type PricingActions = {
  onboarding?: boolean;
  disabled?: boolean;
  pendingPlan?: Product["model"] | null;
  onSelect?: (model: Product["model"]) => void;
};

function formatPrice(amount: number, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

function taxDescription(taxBehavior: string) {
  if (taxBehavior === "inclusive") return "Tax included";
  if (taxBehavior === "exclusive") return "Tax added at checkout";
  return "Final tax calculated at checkout";
}

export function Pricing({ onboarding = false, disabled = false, pendingPlan = null, onSelect }: PricingActions) {
  const { isSignedIn } = useAuth();
  const { isAuthenticated, isLoading, isRefreshing } = useConvexAuth();
  const status = useQuery(api.billing.account.status, isAuthenticated && !isLoading && !isRefreshing ? {} : "skip");
  const currentPlan = status?.state === "active" ? status.model : null;
  const products = useQuery(api.billing.catalog.products, currentPlan === "lifetime" ? "skip" : {});

  if (isLoading || isRefreshing || (isAuthenticated && status === undefined)) {
    return <AuthPending fallback={<PricingSkeleton />} />;
  }

  if (isSignedIn && !isAuthenticated) return <AuthRecovery />;

  if (currentPlan === "lifetime") return <p>You have lifetime access.</p>;
  if (products === undefined) return <AuthPending fallback={<PricingSkeleton />} />;

  if (!products.length) {
    return (
      <Alert>
        <AlertTitle>Paid plans are being configured</AlertTitle>
        <AlertDescription>Please check back soon.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {products.map((product) => (
        <PlanCard
          key={product.model}
          product={product}
          signUp={onboarding && !isAuthenticated}
          currentPlan={currentPlan}
          scheduledPlan={status?.scheduledChange?.model}
          renewalOff={status?.state === "active" && status.cancelAtPeriodEnd}
          disabled={disabled || (isAuthenticated && status?.readiness !== "ready")}
          pendingPlan={pendingPlan}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// Use the same cards to reserve responsive spacing and text wrapping before
// catalog prices arrive. Placeholder amounts are hidden from assistive tools.
export function PricingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Plan prices">
      <p role="status" className="sr-only">Loading paid plans…</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {billingModels.map((model) => (
          <PlanCard
            key={model}
            product={{ model, name: labels[model], amount: 0, currency: "USD", taxBehavior: "provider" }}
            disabled
            loading
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ product, signUp = false, disabled = false, loading = false, currentPlan = null, scheduledPlan = null, renewalOff = false, pendingPlan = null, onSelect }: PricingActions & {
  product: Product;
  signUp?: boolean;
  loading?: boolean;
  currentPlan?: Product["model"] | null;
  scheduledPlan?: Product["model"] | null;
  renewalOff?: boolean;
}) {
  const model = product.model;
  const description = model === "lifetime"
    ? "Full Pro access for the life of the product."
    : "Full Pro access. Cancel any time.";

  return (
    <Card aria-busy={loading || undefined}>
      <CardHeader>
        <CardTitle><h2>{labels[model]}</h2></CardTitle>
      </CardHeader>
      <div className="flex-1">
        <CardContent>
          <div className="flex flex-col gap-4">
            <ContentSkeleton loading={loading}>
              <p className="text-2xl font-semibold">
                {formatPrice(product.amount, product.currency)}
                <span className="text-sm font-normal">{intervals[model]}</span>
              </p>
            </ContentSkeleton>
            <ContentSkeleton loading={loading}>
              <p className="text-sm text-muted-foreground">{taxDescription(product.taxBehavior)}</p>
            </ContentSkeleton>
            <ContentSkeleton loading={loading}>
              <p>{description}</p>
            </ContentSkeleton>
          </div>
        </CardContent>
      </div>
      <CardFooter>
        <ContentSkeleton loading={loading}>
          <PlanAction model={model} signUp={signUp} currentPlan={currentPlan} scheduledPlan={scheduledPlan} renewalOff={renewalOff} disabled={disabled} pending={pendingPlan === model} onSelect={onSelect} />
        </ContentSkeleton>
      </CardFooter>
    </Card>
  );
}

function PlanAction({ model, signUp, currentPlan, scheduledPlan, renewalOff, disabled, pending, onSelect }: {
  model: Product["model"];
  signUp: boolean;
  currentPlan: Product["model"] | null;
  scheduledPlan: Product["model"] | null;
  renewalOff: boolean;
  disabled: boolean;
  pending: boolean;
  onSelect?: PricingActions["onSelect"];
}) {
  const explanationId = useId();
  if (model === currentPlan && !renewalOff) return <Button disabled variant="outline">Current</Button>;
  if (model === scheduledPlan) return <Button disabled variant="outline">Scheduled</Button>;
  let label = `Choose ${labels[model].toLowerCase()}`;
  if (model === "lifetime") label = "Get lifetime";
  else if (currentPlan) label = `Switch to ${labels[model].toLowerCase()}`;
  if (model === currentPlan) label = "Renew";
  let loadingText = "Confirming plan…";
  if (model === "lifetime" || !currentPlan) loadingText = "Opening checkout…";
  else if (model === currentPlan) loadingText = "Confirming renewal…";
  if (renewalOff && model !== currentPlan && model !== "lifetime") {
    const explanation = `Renew your subscription to switch to ${labels[model].toLowerCase()}`;
    // Shown beside the button rather than in a tooltip, which touch can't reach.
    return (
      <div className="flex flex-col items-start gap-2">
        <Button type="button" aria-disabled="true" aria-describedby={explanationId} onClick={event => event.preventDefault()}>
          {label}
        </Button>
        <p id={explanationId} className="text-xs text-muted-foreground">{explanation}</p>
      </div>
    );
  }
  if (onSelect || disabled) {
    return (
      <Button disabled={disabled} onClick={() => onSelect?.(model)} aria-busy={pending} aria-live="polite">
        <ButtonLabel loading={pending} loadingText={loadingText}>
          {label}
        </ButtonLabel>
      </Button>
    );
  }
  // Subscribers confirm recurring plan switches in billing; other choices start checkout.
  const destination = currentPlan && model !== "lifetime" ? `/billing?plan=${model}` : `/checkout?plan=${model}`;
  const href = signUp ? `${SIGN_UP_PATH}?redirect_url=${encodeURIComponent(destination)}` : destination;
  return <Button asChild><NextLink href={href} prefetch={false}>{label}</NextLink></Button>;
}
