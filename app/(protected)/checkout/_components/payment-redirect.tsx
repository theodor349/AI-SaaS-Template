"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { useBillingAccount } from "@/components/billing/use-billing-account";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { rateLimitMessage } from "@/lib/rate-limit";
import { LegalAcceptanceCard, useLegalAcceptance } from "../../_components/legal-acceptance";
import { useCheckout, type CheckoutPlan } from "../../_components/use-checkout";

export function PaymentRedirect({ plan }: { plan: CheckoutPlan }) {
  return (
    <AuthBoundary pending={<PaymentPending />}>
      <PaymentRedirectContent plan={plan} />
    </AuthBoundary>
  );
}

// Deleting accounts and existing paid access leave checkout. Subscribers switch
// recurring plans through billing's confirmation; lifetime is a new purchase.
function exitDestination(status: FunctionReturnType<typeof api.billing.status>, isDeleting: boolean, plan: CheckoutPlan) {
  if (isDeleting) return "/account";
  if (status.state !== "active") return null;
  if (status.model === "lifetime") return "/billing";
  return plan === "lifetime" ? null : `/billing?plan=${plan}`;
}

function PaymentRedirectContent({ plan }: { plan: CheckoutPlan }) {
  const { status, isLoading: billingLoading, isDeleting } = useBillingAccount();
  const legal = useLegalAcceptance();
  const isLoading = billingLoading || legal.isLoading;
  // Checkout starts once the current terms are accepted.
  const awaitingAcceptance = legal.required;
  const router = useRouter();
  const started = useRef(false);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const checkout = useCheckout({
    onError: (error) => setFailure(rateLimitMessage(error) ?? "Your checkout did not open. Please try again."),
  });
  const { start, cancel } = checkout;
  const destination = isLoading || !status ? null : exitDestination(status, isDeleting, plan);

  const openPayment = useCallback(() => {
    setAttempted(true);
    setFailure(null);
    void start(plan);
  }, [start, plan]);

  useEffect(() => {
    if (isLoading) return;
    if (destination) {
      cancel();
      router.replace(destination);
      return;
    }
    if (started.current || awaitingAcceptance) return;

    started.current = true;
    // Consume the selection without leaving this page. Reloading or going Back
    // must not automatically start another checkout after a failed attempt.
    window.history.replaceState(null, "", "/checkout");
    openPayment();
  }, [isLoading, destination, awaitingAcceptance, router, cancel, openPayment]);

  if (isLoading) return <AuthPending fallback={<PaymentPending />} />;
  if (destination === "/account") return <PaymentPending heading="Opening your account settings…" message="We’re taking you to your account settings." />;
  if (destination) return <PaymentPending heading="Opening your billing settings…" message="We’re taking you to your billing settings." />;
  if (awaitingAcceptance) return <AcceptanceRequired />;
  if (checkout.isPending || !attempted) return <PaymentPending />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Let’s get you to checkout.</h1>
      {failure && (
        <Alert variant="destructive">
          <AlertTitle>We couldn’t open the payment page</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={openPayment}>{failure ? "Retry checkout" : "Continue to checkout"}</Button>
        <Button asChild variant="outline"><Link href="/#pricing">Back to plans</Link></Button>
      </div>
    </div>
  );
}

function AcceptanceRequired() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Accept the terms to continue.</h1>
      <LegalAcceptanceCard />
      <div>
        <Button asChild variant="outline"><Link href="/#pricing">Back to plans</Link></Button>
      </div>
    </div>
  );
}

function PaymentPending({
  heading = "Redirecting to the payment page…",
  message = "Please keep this page open while we prepare your secure checkout.",
}: { heading?: string; message?: string }) {
  return (
    <div role="status" className="flex flex-col gap-5">
      <CreditCard aria-hidden="true" size={32} strokeWidth={1.5} />
      <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
      <p className="leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}
