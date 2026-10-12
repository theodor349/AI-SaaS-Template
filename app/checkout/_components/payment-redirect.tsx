"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { useAction } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { api } from "@/convex/_generated/api";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { useBillingAccount } from "@/components/billing/use-billing-account";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Plan = FunctionArgs<typeof api.polar.checkout>["model"];

export function PaymentRedirect({ plan }: { plan: Plan }) {
  return (
    <AuthBoundary pending={<PaymentPending />}>
      <PaymentRedirectContent plan={plan} />
    </AuthBoundary>
  );
}

function PaymentRedirectContent({ plan }: { plan: Plan }) {
  const { status, isLoading, isDeleting } = useBillingAccount();
  const checkout = useAction(api.polar.checkout);
  const router = useRouter();
  const started = useRef(false);
  const requestInFlight = useRef(false);
  const [failed, setFailed] = useState(false);

  const openPayment = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setFailed(false);

    try {
      const url = await checkout({ model: plan, returnUrl: `${window.location.origin}/billing` });
      window.location.assign(url);
    } catch {
      requestInFlight.current = false;
      setFailed(true);
    }
  }, [checkout, plan]);

  useEffect(() => {
    if (isLoading || !status) return;
    if (isDeleting) {
      router.replace("/account");
      return;
    }
    if (status.state === "active") {
      router.replace(status.model === "lifetime" ? "/billing" : `/billing?plan=${plan}`);
      return;
    }
    if (started.current) return;

    started.current = true;
    // Consume the selection without leaving this page. Reloading or going Back
    // must not automatically start another checkout after a failed attempt.
    window.history.replaceState(null, "", "/checkout");
    void openPayment();
  }, [isLoading, isDeleting, status, plan, router, openPayment]);

  if (isLoading) return <AuthPending fallback={<PaymentPending />} />;
  if (isDeleting) return <PaymentPending heading="Opening your account settings…" message="We’re taking you to your account settings." />;
  if (status?.state === "active") return <PaymentPending heading="Opening your billing settings…" message="We’re taking you to your billing settings." />;

  if (failed) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-semibold tracking-tight">Let’s get you to checkout.</h1>
        <Alert variant="destructive">
          <AlertTitle>We couldn’t open the payment page</AlertTitle>
          <AlertDescription>Your checkout did not open. Please try again.</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void openPayment()}>Retry checkout</Button>
          <Button asChild variant="outline"><Link href="/#pricing">Back to plans</Link></Button>
        </div>
      </div>
    );
  }

  return <PaymentPending />;
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
