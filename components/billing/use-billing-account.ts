"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

// Billing and checkout wait for deletion state before exposing payment actions.
export function useBillingAccount() {
  const status = useQuery(api.billing.status);
  const deletion = useQuery(
    api.accountLifecycle.current,
    status?.readiness === "ready" ? {} : "skip",
  );

  return {
    status,
    isLoading:
      !status ||
      status.readiness === "provisioning" ||
      (status.readiness === "ready" && deletion === undefined),
    isDeleting:
      status?.readiness === "deleting" ||
      deletion?.status === "pending" ||
      deletion?.finalizing === true,
  };
}
