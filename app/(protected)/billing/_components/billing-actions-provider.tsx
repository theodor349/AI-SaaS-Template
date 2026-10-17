"use client";

import { createContext, useContext, type ReactNode } from "react";
import { toast } from "sonner";
import { hasErrorCode } from "@/convex/lib/errors";
import { rateLimitMessage } from "@/lib/rate-limit";
import { useCheckout } from "../../_components/use-checkout";
import { useBillingActions } from "./use-billing-actions";

const BillingActionsContext = createContext<{
  actions: ReturnType<typeof useBillingActions>;
  checkout: ReturnType<typeof useCheckout>;
} | null>(null);

function checkoutFailed(error: unknown) {
  const description = hasErrorCode(error, "LEGAL_ACCEPTANCE_REQUIRED")
    ? "Accept the Terms of Service first, then try again."
    : rateLimitMessage(error) ?? "Please try again in a moment.";
  toast.error("We couldn’t open checkout", { description, id: "billing-request-error" });
}

// Status controls and plan cards share pending state to prevent competing requests.
export function BillingActionsProvider({ children }: { children: ReactNode }) {
  const actions = useBillingActions();
  const checkout = useCheckout({ onError: checkoutFailed });
  return <BillingActionsContext.Provider value={{ actions, checkout }}>{children}</BillingActionsContext.Provider>;
}

export function useBillingRequests() {
  const requests = useContext(BillingActionsContext);
  if (!requests) throw new Error("Billing requests require BillingActionsProvider");
  return requests;
}
