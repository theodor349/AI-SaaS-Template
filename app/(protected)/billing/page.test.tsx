// @vitest-environment happy-dom
import { act } from "react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { onCall, resetConvex, setQuery } from "@/tests/component/fake-convex";
import { click, getByRole, queryByRole, render, settle, waitFor } from "@/tests/component/render";
import BillingPage from "./page";

// These tests cover billing turned on, whatever app.config.ts sets.
vi.mock("@/app.config", async (importOriginal) => {
  const { appConfig } = await importOriginal<typeof import("@/app.config")>();
  return { appConfig: { ...appConfig, billing: true } };
});

vi.mock("convex/react", () => import("@/tests/component/fake-convex"));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }), SignInButton: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

type Status = FunctionReturnType<typeof api.billing.account.status>;

const unpaid: Status = {
  readiness: "ready", state: "awaiting_payment", model: null, paidThrough: null, lifetimePurchasedAt: null,
  cancelAtPeriodEnd: false, hasCustomer: false, revision: 0, scheduledChange: null,
};
const monthly: Status = { ...unpaid, state: "active", model: "monthly", paidThrough: Date.now() + 20 * 86_400_000, hasCustomer: true, revision: 1 };
const catalog = (["monthly", "yearly", "lifetime"] as const).map((model) => ({
  model, name: model, amount: 2000, currency: "USD", taxBehavior: "provider" as const,
}));

let navigate: ReturnType<typeof vi.fn<Location["assign"]>>;

beforeEach(() => {
  resetConvex();
  setQuery(api.account.lifecycle.current, null);
  setQuery(api.billing.account.syncStatus, { failure: null, retrying: false });
  setQuery(api.billing.withdrawals.purchases, []);
  setQuery(api.billing.catalog.products, catalog);
  navigate = vi.fn();
  vi.spyOn(window.location, "assign").mockImplementation(navigate);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderBilling(status: Status) {
  setQuery(api.billing.account.status, status);
  render(<><BillingPage /><Toaster /></>);
}

// Answers each call to `fn` only when the test settles it, in order.
function holdCalls(fn: typeof api.billing.polar.checkout | typeof api.billing.polar.portal) {
  const calls: Array<PromiseWithResolvers<string>> = [];
  onCall(fn, () => {
    const call = Promise.withResolvers<string>();
    calls.push(call);
    return call.promise;
  });
  return calls;
}

// happy-dom's PageTransitionEvent is a plain Event that drops `persisted`.
function pageshow(persisted: boolean) {
  act(() => {
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
  });
}

test("subscription controls remain usable while plan prices load independently", () => {
  setQuery(api.billing.catalog.products, undefined);
  renderBilling(monthly);

  expect(getByRole("button", "Customer portal")).toHaveProperty("disabled", false);
  expect(getByRole("button", "Cancel subscription")).toHaveProperty("disabled", false);
  expect(document.querySelector('[aria-label="Plan prices"]')?.getAttribute("aria-busy")).toBe("true");
  expect(queryByRole("button", "Switch to yearly")).toBeNull();

  act(() => setQuery(api.billing.catalog.products, catalog));
  expect(getByRole("button", "Switch to yearly")).toHaveProperty("disabled", false);
});

test("checkout disables duplicate attempts until the request fails, then permits retry", async () => {
  const calls = holdCalls(api.billing.polar.checkout);
  renderBilling(unpaid);

  await click(getByRole("button", "Choose monthly"));
  const pending = getByRole("button", "Opening checkout…");
  expect(pending).toHaveProperty("disabled", true);
  expect(pending.getAttribute("aria-busy")).toBe("true");
  // Reaches the handler even though the button is disabled.
  await act(async () => {
    pending.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(calls).toHaveLength(1);

  await act(async () => calls[0].reject(new Error("Fixture checkout failure")));
  await waitFor(() => expect(document.querySelector("[data-sonner-toast]")?.textContent).toContain("We couldn’t open checkout"));
  expect(getByRole("button", "Choose monthly")).toHaveProperty("disabled", false);

  await click(getByRole("button", "Choose monthly"));
  expect(getByRole("button", "Opening checkout…")).toHaveProperty("disabled", true);
  expect(calls).toHaveLength(2);
  await act(async () => calls[1].reject(new Error("Fixture checkout failure")));
  expect(getByRole("button", "Choose monthly")).toHaveProperty("disabled", false);
  expect(navigate).not.toHaveBeenCalled();
});

test("lifetime access shows the purchase date and opens the customer portal", async () => {
  const purchasedAt = Date.UTC(2026, 9, 3, 12);
  const portalUrl = "https://sandbox.polar.sh/fixture-lifetime-portal";
  const calls = holdCalls(api.billing.polar.portal);
  renderBilling({ ...unpaid, state: "active", model: "lifetime", lifetimePurchasedAt: purchasedAt, hasCustomer: true, revision: 1 });

  const purchased = document.querySelector<HTMLInputElement>("#billing-paid-through")!;
  expect(document.querySelector('label[for="billing-paid-through"]')?.textContent).toBe("Purchased on");
  expect(purchased.value).toBe(new Date(purchasedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }));
  expect(purchased.disabled).toBe(true);
  expect(document.querySelector<HTMLInputElement>("#billing-plan")?.value).toBe("Lifetime Pro");
  // Lifetime leaves nothing to buy or cancel.
  expect(document.querySelector('[aria-label="Paid plans"]')).toBeNull();
  expect(queryByRole("button", "Cancel subscription")).toBeNull();

  await click(getByRole("button", "Customer portal"));
  expect(getByRole("button", "Opening portal…")).toHaveProperty("disabled", true);
  expect(calls).toHaveLength(1);
  await act(async () => calls[0].resolve(portalUrl));
  expect(navigate).toHaveBeenCalledExactlyOnceWith(portalUrl);
});

for (const action of ["checkout", "portal"] as const) {
  test(`${action} permits another request after a cached page is restored`, async () => {
    const fn = action === "checkout" ? api.billing.polar.checkout : api.billing.polar.portal;
    let requests = 0;
    onCall(fn, () => `https://polar.test/navigation-${++requests}`);
    renderBilling(action === "checkout" ? unpaid : monthly);
    const label = action === "checkout" ? "Choose monthly" : "Customer portal";
    const progress = action === "checkout" ? "Opening checkout…" : "Opening portal…";

    await click(getByRole("button", label));
    expect(navigate).toHaveBeenLastCalledWith("https://polar.test/navigation-1");
    // The browser is leaving, so the control stays pending, unless Back restores
    // this page from the cache.
    pageshow(false);
    expect(getByRole("button", progress)).toHaveProperty("disabled", true);
    pageshow(true);
    expect(getByRole("button", label)).toHaveProperty("disabled", false);

    await click(getByRole("button", label));
    await settle();
    expect(navigate).toHaveBeenLastCalledWith("https://polar.test/navigation-2");
    expect(requests).toBe(2);
  });
}
