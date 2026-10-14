"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { AuthPending } from "@/components/auth/auth-boundary";
import { useAction } from "@/lib/convex";

export function PaidBoundary({ children }: { children: ReactNode }) {
  const status = useQuery(api.billing.status);
  const recover = useAction(api.polar.recover);
  const router = useRouter();
  const deleting = status?.readiness === "deleting";
  const ready = status?.readiness === "ready";
  const active = status?.state === "active";
  const paidThrough = status?.paidThrough;
  useEffect(() => {
    if (deleting) router.replace("/account");
    else if (ready && !active) router.replace("/billing");
  }, [deleting, ready, active, router]);
  useEffect(() => {
    if (!paidThrough) return;
    const timer = setTimeout(() => { void recover({}).catch(() => router.replace("/billing")); }, Math.min(2_147_483_647, Math.max(0, paidThrough - Date.now())));
    return () => clearTimeout(timer);
  }, [paidThrough, recover, router]);
  if (!ready || !active) return <AuthPending message="Checking paid access…" />;
  return children;
}
