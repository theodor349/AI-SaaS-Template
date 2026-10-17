"use client";

import type { FunctionArgs } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAction } from "@/lib/convex";

export type CheckoutPlan = FunctionArgs<typeof api.billing.polar.checkout>["model"];

// Opens Polar checkout for one plan at a time. A started checkout stays pending
// until the browser leaves, so callers can keep its control disabled. A cached
// page restored with Back, cancel(), or unmounting allows another attempt and
// stops a late response from navigating away from where the user went.
export function useCheckout({ onError }: { onError?: (error: unknown) => void } = {}) {
  const checkout = useAction(api.billing.polar.checkout);
  const mounted = useRef(false);
  const attempt = useRef(0);
  const requestInFlight = useRef(false);
  const latestOnError = useRef(onError);
  const [pendingPlan, setPendingPlan] = useState<CheckoutPlan | null>(null);

  useEffect(() => {
    latestOnError.current = onError;
  }, [onError]);

  const cancel = useCallback(() => {
    attempt.current++;
    requestInFlight.current = false;
    setPendingPlan(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    function restore(event: PageTransitionEvent) {
      if (event.persisted) cancel();
    }
    window.addEventListener("pageshow", restore);
    return () => {
      mounted.current = false;
      window.removeEventListener("pageshow", restore);
    };
  }, [cancel]);

  const start = useCallback(async (plan: CheckoutPlan) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const current = ++attempt.current;
    setPendingPlan(plan);

    try {
      const url = await checkout({ model: plan, returnUrl: `${window.location.origin}/billing` });
      if (mounted.current && attempt.current === current) window.location.assign(url);
    } catch (error) {
      if (!mounted.current || attempt.current !== current) return;
      cancel();
      latestOnError.current?.(error);
    }
  }, [checkout, cancel]);

  return { start, cancel, pendingPlan, isPending: pendingPlan !== null };
}
