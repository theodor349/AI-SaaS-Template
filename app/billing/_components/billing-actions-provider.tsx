"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useBillingActions } from "./use-billing-actions";
import { useBillingCheckout } from "./use-billing-checkout";

const BillingActionsContext = createContext<{
  actions: ReturnType<typeof useBillingActions>;
  checkout: ReturnType<typeof useBillingCheckout>;
} | null>(null);

// Status controls and plan cards share pending state to prevent competing requests.
export function BillingActionsProvider({ children }: { children: ReactNode }) {
  const actions = useBillingActions();
  const checkout = useBillingCheckout();
  return <BillingActionsContext.Provider value={{ actions, checkout }}>{children}</BillingActionsContext.Provider>;
}

export function useBillingRequests() {
  const requests = useContext(BillingActionsContext);
  if (!requests) throw new Error("Billing requests require BillingActionsProvider");
  return requests;
}
