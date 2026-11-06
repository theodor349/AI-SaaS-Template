"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { TextSkeleton } from "@/components/loading/content-skeleton";

export function Welcome() {
  const application = useQuery(api.billing.account.application);
  if (application === undefined) return <TextSkeleton>Welcome to your account!</TextSkeleton>;
  return <p>Welcome {application.name}!</p>;
}
