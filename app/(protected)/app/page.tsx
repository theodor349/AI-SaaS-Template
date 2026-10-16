"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AuthPending } from "@/components/auth/auth-boundary";
import { Link } from "@/components/typography/link";

export default function ApplicationPage() {
  const identity = useQuery(api.billing.application);
  if (identity === undefined) return <AuthPending message="Loading your account…" />;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Your application</h1>
      </div>
      <p>Welcome {identity.name ?? "to your account"}!</p>
      <Link href="/billing" className="inline-flex items-center self-start pointer-coarse:min-h-12">Manage billing</Link>
    </div>
  );
}
