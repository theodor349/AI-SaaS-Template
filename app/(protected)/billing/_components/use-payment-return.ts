"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { isBillingModel } from "@/convex/billing/plans";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";

// Polar returns buyers to `/billing?confirmation=<plan>`. Billing waits for that
// plan's confirmation, then opens the product. Polar's customer session token
// is removed from the address bar either way.
export function usePaymentReturn(status: FunctionReturnType<typeof api.billing.account.status> | undefined) {
  const params = useSearchParams();
  const router = useRouter();
  const confirmation = params.get("confirmation");
  const plan = isBillingModel(confirmation) ? confirmation : null;
  const confirmed = plan !== null && status?.state === "active" && status.model === plan;
  const hasSessionToken = params.has("customer_session_token");

  useEffect(() => {
    if (confirmed) {
      router.replace(AUTHENTICATED_DESTINATION);
    } else if (hasSessionToken) {
      const next = new URLSearchParams(params.toString());
      next.delete("customer_session_token");
      router.replace(`/billing?${next}`, { scroll: false });
    }
  }, [confirmed, hasSessionToken, params, router]);

  return { pending: plan !== null && !confirmed, confirmed };
}
