"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Pricing } from "@/components/billing/pricing";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";

export default function Home() {
  return (
    <div className="container mx-auto px-4 max-w-2xl flex flex-col gap-8">
      <h1 className="text-4xl font-extrabold my-8 text-center">Pro access for every application user</h1>
      <AuthBoundary signedOut={<p>Sign in to get started.</p>}><SignedInContent /></AuthBoundary>
      <Pricing />
    </div>
  );
}

function SignedInContent() {
  const identity = useQuery(api.auth.currentIdentity);
  if (!identity) return <AuthPending message="Loading your account…" />;
  return <p>Welcome {identity.name ?? "to your account"}!</p>;
}
