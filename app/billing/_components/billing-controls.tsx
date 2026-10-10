"use client";

import { SignOutButton, UserButton } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AuthPending } from "@/components/auth/auth-boundary";
import { Pricing } from "@/components/billing/pricing";
import type { BillingModel } from "@/convex/lib/billing";

const label = { monthly: "Monthly Pro", yearly: "Yearly Pro", lifetime: "Lifetime Pro" };
type Operation = "cancel" | "reactivate" | "monthly" | "yearly";
export function BillingControls() {
  const status = useQuery(api.billing.status);
  const identity = useQuery(api.auth.currentIdentity);
  const checkout = useAction(api.polar.checkout);
  const portal = useAction(api.polar.portal);
  const change = useAction(api.polar.changeSubscription);
  const recover = useAction(api.polar.recover);
  const params = useSearchParams();
  const selected = params.get("plan");
  const selectedPlan = selected === "monthly" || selected === "yearly" || selected === "lifetime" ? selected : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [expectation, setExpectation] = useState<{ operation: Operation; revision: number } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const fulfilled = expectation && status && status.revision > expectation.revision && (
    expectation.operation === "cancel" ? status.cancelAtPeriodEnd : expectation.operation === "reactivate" ? !status.cancelAtPeriodEnd && status.state === "active" : status.model === expectation.operation && status.state === "active"
  );
  useEffect(() => {
    if (!expectation || fulfilled) return;
    const timer = setTimeout(() => setTimedOut(true), 15_000);
    return () => clearTimeout(timer);
  }, [expectation, fulfilled]);
  const pending = !!expectation && !fulfilled;
  const confirmationPending = params.get("confirmation") === "pending" && status?.state !== "active";
  async function run(operation: () => Promise<unknown>, expected?: Operation) {
    setBusy(true); setError(false); setTimedOut(false); setConfirmed(false);
    setExpectation(expected && status ? { operation: expected, revision: status.revision } : null);
    try { await operation(); if (!expected) setConfirmed(true); }
    catch { setError(true); setExpectation(null); }
    finally { setBusy(false); }
  }
  const returnUrl = () => `${window.location.origin}/billing`;
  const purchase = (model: BillingModel) => run(async () => { window.location.assign(await checkout({ model, returnUrl: returnUrl() })); });
  if (!status || status.readiness === "provisioning") return <AuthPending message="Setting up your billing account…" />;
  if (status.readiness === "deleting") return <p>Account deletion has been requested. <SignOutButton><Button variant="outline">Sign out</Button></SignOutButton></p>;
  const recurring = status.state === "active" && status.model !== "lifetime";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between"><h1 className="text-3xl font-bold">Billing</h1><UserButton /></div>
      <p>Welcome {identity?.name ?? "to your account"}!</p>
      <Card>
        <CardHeader><CardTitle><h2>{status.state === "active" && status.model ? label[status.model] : status.state === "ended" ? "Restore Pro access" : "Choose your paid plan"}</h2></CardTitle></CardHeader>
        <CardContent><div className="flex flex-col gap-3">
        {status.state === "active" ? <>
          <p>Your paid access is confirmed.</p>
          {status.paidThrough && <p>{status.cancelAtPeriodEnd ? "Access ends" : "Paid through"} {new Date(status.paidThrough).toLocaleDateString()}.</p>}
          <div><Button asChild><NextLink href="/app" prefetch={false}>Open application</NextLink></Button></div>
        </> : <p>Pro payment is required to use the application. Billing and account controls remain available.</p>}
        {confirmationPending && <p role="status">Payment confirmation pending. We’ll update this page when paid access is confirmed. If it doesn’t arrive, check payment status below.</p>}
        {status.failure && <p role="alert">Billing needs another check. Use payment status or the customer portal to recover.</p>}
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} variant="outline" onClick={() => void run(() => recover({}))}>Check payment status</Button>
          {status.hasCustomer && <Button disabled={busy} variant="outline" onClick={() => void run(async () => { window.location.assign(await portal({ returnUrl: returnUrl() })); })}>Customer portal</Button>}
          <SignOutButton><Button variant="ghost">Sign out</Button></SignOutButton>
        </div>
        {recurring && <div className="flex flex-wrap gap-3">
          <Button disabled={busy || (pending && !timedOut)} variant="outline" onClick={() => void run(() => change({ operation: status.cancelAtPeriodEnd ? "reactivate" : "cancel" }), status.cancelAtPeriodEnd ? "reactivate" : "cancel")}>{status.cancelAtPeriodEnd ? "Reactivate subscription" : "Cancel subscription"}</Button>
          <Button disabled={busy || (pending && !timedOut)} variant="outline" onClick={() => { const operation = status.model === "monthly" ? "yearly" : "monthly"; void run(() => change({ operation }), operation); }}>Switch to {status.model === "monthly" ? "yearly" : "monthly"}</Button>
          <Button disabled={busy} onClick={() => void purchase("lifetime")}>Upgrade to lifetime</Button>
        </div>}
        {error && <p role="alert">We couldn’t complete the billing request. Please try again or use the customer portal.</p>}
        {pending && !timedOut && <p role="status">Waiting for confirmed billing state…</p>}
        {pending && timedOut && <p role="alert">The change is still unconfirmed. Check payment status or retry the change.</p>}
        {fulfilled && <p role="status">Billing change confirmed.</p>}
        {confirmed && !busy && !expectation && <p role="status">Payment status check requested. The billing state above shows your confirmed access.</p>}
      </div></CardContent>
      </Card>
      {status.state !== "active" && <>
        {selectedPlan && <div><Button disabled={busy} onClick={() => void purchase(selectedPlan)}>Continue with {selectedPlan}</Button></div>}
        <Pricing />
        {!selectedPlan && <p>Select a plan above to continue to checkout.</p>}
      </>}
    </div>
  );
}
