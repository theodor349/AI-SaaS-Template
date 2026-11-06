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
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
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
  const view = render(<PaymentRedirect plan="monthly" />);
  expect(view.container.querySelector("h1")?.textContent).toBe("Redirecting to the payment page…");
  expect(checkouts).toHaveLength(1);
  return view;
}

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
