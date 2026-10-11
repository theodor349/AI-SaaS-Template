"use client";

import { useAction } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";

export function useBillingCheckout() {
  const checkout = useAction(api.polar.checkout);
  const requestInFlight = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<FunctionArgs<typeof api.polar.checkout>["model"] | null>(null);

  // External navigation keeps the button pending until the page leaves. A
  // cached page restored with Back must allow a new checkout attempt.
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      requestInFlight.current = false;
      setIsPending(false);
      setPendingPlan(null);
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  async function purchase(model: FunctionArgs<typeof api.polar.checkout>["model"]) {
    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setIsPending(true);
    setPendingPlan(model);
    toast.dismiss("billing-request-error");

    try {
      const url = await checkout({ model, returnUrl: `${window.location.origin}/billing` });
      window.location.assign(url);
    } catch {
      toast.error("We couldn’t open checkout", {
        description: "Please try again in a moment.",
        id: "billing-request-error",
      });
      requestInFlight.current = false;
      setIsPending(false);
      setPendingPlan(null);
    }
  }

  return { purchase, isPending, pendingPlan };
}
