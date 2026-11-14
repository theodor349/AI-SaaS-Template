"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { AccountPending, connectingStep, useAccountStatus, type PendingStep } from "@/components/auth/account-boundary";
import { billingEnabled } from "@/convex/billing/plans";
import { useAction } from "@/lib/convex";

const steps: PendingStep[] = [
  connectingStep,
  { label: "Checking paid access…", detail: "Making sure your plan includes the app." },
];

// AccountBoundary with a paid check on top: it sends users without Pro to /billing and
// asks Polar again when the paid time runs out. Render it below an AuthBoundary with
// `renderWhilePending`, so this one component shows both loading steps and its spinner
// keeps turning between them.
export function PaidBoundary({ children }: { children: ReactNode }) {
  const { status, ready, step } = useAccountStatus();
  const recover = useAction(api.billing.polar.recover);
  const router = useRouter();
  // Mirrors requirePro, which lets every active user in when billing is off.
  const active = !billingEnabled || status?.state === "active";
  const paidThrough = billingEnabled ? status?.paidThrough : null;
  useEffect(() => {
    if (ready && !active) router.replace("/billing");
  }, [ready, active, router]);
  useEffect(() => {
    if (!paidThrough) return;
    const timer = setTimeout(() => { void recover({}).catch(() => router.replace("/billing")); }, Math.min(2_147_483_647, Math.max(0, paidThrough - Date.now())));
    return () => clearTimeout(timer);
  }, [paidThrough, recover, router]);
  if (!ready || !active) return <AccountPending steps={steps} step={step} />;
  return children;
}
