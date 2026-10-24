"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { hasErrorCode } from "@/convex/lib/errors";
import { useAction } from "@/lib/convex";
import { rateLimitMessage } from "@/lib/rate-limit";

type SubscriptionOperation = FunctionArgs<typeof api.billing.polar.changeSubscription>["operation"];
type BillingAction = SubscriptionOperation | "portal";
type Expectation = { operation: SubscriptionOperation; revision: number };

function matchesExpectation(
  status: FunctionReturnType<typeof api.billing.account.status> | undefined,
  expectation: Expectation | null,
) {
  if (!status || !expectation || status.revision <= expectation.revision) {
    return false;
  }

  if (expectation.operation === "cancel") {
    return status.cancelAtPeriodEnd;
  }

  if (expectation.operation === "reactivate") {
    return !status.cancelAtPeriodEnd && status.state === "active";
  }

  return status.state === "active" && (
    status.model === expectation.operation || status.scheduledChange?.model === expectation.operation
  );
}

// An action acknowledgement does not confirm a subscription change. Keep its
// button pending until a newer billing publication matches the requested state.
export function useBillingActions() {
  const { isAuthenticated, isLoading, isRefreshing } = useConvexAuth();
  const status = useQuery(api.billing.account.status, isAuthenticated && !isLoading && !isRefreshing ? {} : "skip");
  const change = useAction(api.billing.polar.changeSubscription);
  const portal = useAction(api.billing.polar.portal);
  const requestInFlight = useRef(false);
  const [busyAction, setBusyAction] = useState<BillingAction | null>(null);
  const [expectation, setExpectation] = useState<Expectation | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const fulfilled = matchesExpectation(status, expectation);
  const pending = expectation !== null && !fulfilled;

  // Forget a confirmed change. Kept, it would count as pending again once later
  // billing state, such as Pro ending, stops matching it.
  if (fulfilled) {
    setExpectation(null);
    setTimedOut(false);
  }

  // Restore portal controls after Back returns a cached page. Subscription
  // expectations still wait for confirmed provider state.
  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      requestInFlight.current = false;
      setBusyAction(null);
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timer = setTimeout(() => setTimedOut(true), 15_000);
    return () => clearTimeout(timer);
  }, [expectation, pending]);

  async function run(action: BillingAction) {
    const isChange = action !== "portal";

    if (requestInFlight.current || (isChange && pending && !timedOut)) {
      return;
    }

    requestInFlight.current = true;
    setBusyAction(action);
    toast.dismiss("billing-request-error");

    if (isChange && status) {
      setTimedOut(false);
      setExpectation({ operation: action, revision: status.revision });
    }

    let navigating = false;

    try {
      if (action === "portal") {
        const url = await portal({ returnUrl: `${window.location.origin}/billing` });
        window.location.assign(url);
        navigating = true;
      } else {
        await change({ operation: action });
      }
    } catch (error) {
      const needsReactivation = hasErrorCode(error, "SUBSCRIPTION_REACTIVATION_REQUIRED");
      toast.error("We couldn’t complete the billing request", {
        description: needsReactivation
          ? "Reactivate your subscription before switching plans."
          : rateLimitMessage(error) ?? "Please try again or use the customer portal.",
        id: "billing-request-error",
      });

      if (isChange) {
        setExpectation(null);
      }
    } finally {
      if (!navigating) {
        requestInFlight.current = false;
        setBusyAction(null);
      }
    }
  }

  function isPending(action: BillingAction) {
    return busyAction === action || (
      pending && !timedOut && expectation.operation === action
    );
  }

  return {
    run,
    isPending,
    isBusy: busyAction !== null,
    changePending: pending && !timedOut,
    isUnconfirmed: pending && timedOut,
  };
}
