"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { AuthPending } from "@/components/auth/auth-boundary";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type PendingStep = { label: string; detail: string };

export const connectingStep: PendingStep = {
  label: "Connecting your account…",
  detail: "Confirming your sign-in with the server.",
};

const accountSteps: PendingStep[] = [
  connectingStep,
  { label: "Loading your account…", detail: "Making sure your account is ready to use." },
];

// Reads the signed-in account's status and sends an account that is being deleted to
// /account. `step` is 0 while Convex confirms the sign-in and 1 while the status loads.
export function useAccountStatus() {
  const convex = useConvexAuth();
  const authenticated = convex.isAuthenticated && !convex.isLoading;
  const status = useQuery(api.billing.account.status, authenticated ? {} : "skip");
  const router = useRouter();
  const deleting = status?.readiness === "deleting";
  useEffect(() => {
    if (deleting) router.replace("/account");
  }, [deleting, router]);
  return { status, ready: status?.readiness === "ready", step: authenticated ? 1 : 0 };
}

// Mounts its children once the signed-in account is ready. It makes no paid check, so an
// app with `billing: false` uses it in place of PaidBoundary. Render it below an
// AuthBoundary with `renderWhilePending`, so this one component shows both loading steps
// and its spinner keeps turning between them.
export function AccountBoundary({ children }: { children: ReactNode }) {
  const { ready, step } = useAccountStatus();
  if (!ready) return <AccountPending steps={accountSteps} step={step} />;
  return children;
}

// Fixed to the viewport center, with every step's text stacked in one grid cell,
// so a step change swaps only the visible text and nothing shifts.
export function AccountPending({ steps, step }: { steps: PendingStep[]; step: number }) {
  return (
    <AuthPending
      fallback={
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
      }
    />
  );
}
