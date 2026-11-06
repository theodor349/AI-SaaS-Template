"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { AuthPending } from "@/components/auth/auth-boundary";
import { Spinner } from "@/components/ui/spinner";
import { billingEnabled } from "@/convex/billing/plans";
import { useAction } from "@/lib/convex";
import { cn } from "@/lib/utils";

const steps = [
  { label: "Connecting your account…", detail: "Confirming your sign-in with the server." },
  { label: "Checking paid access…", detail: "Making sure your plan includes the app." },
];

// Render it below an AuthBoundary with `renderWhilePending`, so this one component
// shows both loading steps and its spinner keeps turning between them.
export function PaidBoundary({ children }: { children: ReactNode }) {
  const convex = useConvexAuth();
  const authenticated = convex.isAuthenticated && !convex.isLoading;
  const status = useQuery(api.billing.account.status, authenticated ? {} : "skip");
  const recover = useAction(api.billing.polar.recover);
  const router = useRouter();
  const deleting = status?.readiness === "deleting";
  const ready = status?.readiness === "ready";
  // Mirrors requirePro, which lets every active user in when billing is off.
  const active = !billingEnabled || status?.state === "active";
  const paidThrough = billingEnabled ? status?.paidThrough : null;
  useEffect(() => {
    if (deleting) router.replace("/account");
    else if (ready && !active) router.replace("/billing");
  }, [deleting, ready, active, router]);
  useEffect(() => {
    if (!paidThrough) return;
    const timer = setTimeout(() => { void recover({}).catch(() => router.replace("/billing")); }, Math.min(2_147_483_647, Math.max(0, paidThrough - Date.now())));
    return () => clearTimeout(timer);
  }, [paidThrough, recover, router]);
  if (!ready || !active) return <AuthPending fallback={<PaidAccessPending step={authenticated ? 1 : 0} />} />;
  return children;
}

// Fixed to the viewport center, with every step's text stacked in one grid cell,
// so a step change swaps only the visible text and nothing shifts.
function PaidAccessPending({ step }: { step: number }) {
  return (
    <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-5 text-center">
        <Spinner size="lg" aria-hidden="true" />
        <p role="status" className="sr-only">{steps[step].label}</p>
        <div aria-hidden="true" className="grid">
          {steps.map(({ label, detail }, index) => (
            <div key={label} className={cn("col-start-1 row-start-1 flex flex-col gap-1", index !== step && "invisible")}>
              <p className="font-medium">{label}</p>
              <p className="text-sm text-muted-foreground">{detail}</p>
            </div>
          ))}
        </div>
        <ol aria-hidden="true" className="flex gap-2">
          {steps.map(({ label }, index) => (
            <li key={label} className={cn("h-1 w-8 rounded-full bg-muted transition-colors duration-300", index <= step && "bg-primary")} />
          ))}
        </ol>
      </div>
    </div>
  );
}
