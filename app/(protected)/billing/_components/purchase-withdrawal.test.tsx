// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { resetConvex, setQuery } from "@/tests/component/fake-convex";
import { queryByRole, render } from "@/tests/component/render";
import { PurchaseWithdrawal } from "./purchase-withdrawal";

vi.mock("convex/react", () => import("@/tests/component/fake-convex"));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }), SignInButton: () => null }));

const day = 24 * 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  resetConvex();
  setQuery(api.account.users.current, { status: "provisioning" });
});

afterEach(() => {
  vi.useRealTimers();
});

test("the withdrawal control disappears when the period ends", () => {
  // Days away, as for a purchase whose period runs past a weekend.
  const withdrawUntil = Date.now() + 3 * day;
  setQuery(api.billing.withdrawals.purchases, [
    { orderId: "order-lifetime", model: "lifetime", purchasedAt: withdrawUntil - 14 * day, withdrawUntil, withdrawal: null },
  ]);
  const { container } = render(<PurchaseWithdrawal />);
  expect(queryByRole("button", "Withdraw from contract")).not.toBeNull();

  act(() => {
    vi.advanceTimersByTime(withdrawUntil - Date.now() - 1);
  });
  expect(queryByRole("button", "Withdraw from contract")).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(container.textContent).toBe("");
});
