// @vitest-environment happy-dom
import { act } from "react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { onCall, resetConvex, setQuery } from "@/tests/component/fake-convex";
import { render } from "@/tests/component/render";
import { PaymentRedirect } from "./payment-redirect";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("convex/react", () => import("@/tests/component/fake-convex"));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }), SignInButton: () => null }));
// Like Next, history.replaceState updates useSearchParams and re-renders its readers.
const search = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set: (url: string) => {
      params = new URL(url, "https://app.test").searchParams;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useRouter: () => router, useSearchParams: () => useSyncExternalStore(search.subscribe, search.get) };
});

type Status = FunctionReturnType<typeof api.billing.account.status>;

const unpaid: Status = {
  readiness: "ready", state: "awaiting_payment", model: null, paidThrough: null, lifetimePurchasedAt: null,
  cancelAtPeriodEnd: false, hasCustomer: false, revision: 0, scheduledChange: null,
};
const checkoutUrl = "https://polar.test/stale-checkout";
let navigate: ReturnType<typeof vi.fn<Location["assign"]>>;
let checkouts: Array<PromiseWithResolvers<string>>;

beforeEach(() => {
  resetConvex();
  router.replace.mockClear();
  navigate = vi.fn();
  vi.spyOn(window.location, "assign").mockImplementation(navigate);
  search.set("/checkout?plan=monthly");
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, url) => search.set(String(url)));
  checkouts = [];
  onCall(api.billing.polar.checkout, () => {
    const checkout = Promise.withResolvers<string>();
    checkouts.push(checkout);
    return checkout.promise;
  });
  setQuery(api.billing.account.status, unpaid);
  setQuery(api.account.lifecycle.current, null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderCheckout() {
  const view = render(<PaymentRedirect />);
  expect(view.container.querySelector("h1")?.textContent).toBe("Redirecting to the payment page…");
  expect(checkouts).toHaveLength(1);
  return view;
}

test("starting checkout removes the plan from the URL without leaving the page", () => {
  renderCheckout();
  expect(search.get().has("plan")).toBe(false);
  expect(router.replace).not.toHaveBeenCalled();
});

test("an unknown plan returns to the plans without starting checkout", () => {
  search.set("/checkout?plan=weekly");
  render(<PaymentRedirect />);
  expect(router.replace).toHaveBeenCalledExactlyOnceWith("/#pricing");
  expect(checkouts).toHaveLength(0);
});

async function deliverCheckout() {
  await act(async () => checkouts[0].resolve(checkoutUrl));
}

test("a checkout that answers while the user stays opens the payment page", async () => {
  renderCheckout();
  await deliverCheckout();
  expect(navigate).toHaveBeenCalledExactlyOnceWith(checkoutUrl);
});

test("a pending checkout cannot override paid navigation", async () => {
  renderCheckout();
  act(() => setQuery(api.billing.account.status, { ...unpaid, state: "active", model: "lifetime", hasCustomer: true, revision: 1 }));
  expect(router.replace).toHaveBeenCalledWith("/billing");
  await deliverCheckout();
  expect(navigate).not.toHaveBeenCalled();
});

test("a pending checkout cannot override deleting navigation", async () => {
  renderCheckout();
  act(() => setQuery(api.account.lifecycle.current, {
    status: "pending", source: "user", deleteAfter: Date.now() + 86_400_000, finalizing: false, cancellationConfirmed: false, failure: false,
  }));
  expect(router.replace).toHaveBeenCalledWith("/account");
  await deliverCheckout();
  expect(navigate).not.toHaveBeenCalled();
});

test("a pending checkout cannot override manual navigation", async () => {
  // Leaving through the app's own links unmounts the page.
  renderCheckout().unmount();
  await deliverCheckout();
  expect(navigate).not.toHaveBeenCalled();
});
