// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import manifest from "@/app/manifest";
import BillingPage from "@/app/(protected)/billing/page";
import CheckoutPage from "@/app/(protected)/checkout/page";
import { PaidBoundary } from "./paid-boundary";

// The same app with `billing: false` in app.config.ts.
vi.mock("@/app.config", async (importOriginal) => {
  const { appConfig } = await importOriginal<typeof import("@/app.config")>();
  return { appConfig: { ...appConfig, billing: false } };
});
const router = vi.hoisted(() => ({ replace: vi.fn() }));
const recover = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); },
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  // A user with no billing account whose last plan ran out.
  useQuery: () => ({ readiness: "ready", state: "ended", paidThrough: Date.now() - 1000 }),
}));
vi.mock("@/lib/convex", () => ({ useAction: () => recover }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("signed-in users reach paid pages without a plan", () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<PaidBoundary><p>Notes</p></PaidBoundary>));
  act(() => { vi.runAllTimers(); });
  expect(container.textContent).toBe("Notes");
  expect(router.replace).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
  act(() => root.unmount());
  vi.useRealTimers();
});

test("billing and checkout pages are not found", async () => {
  expect(() => BillingPage()).toThrow("NEXT_NOT_FOUND");
  await expect(CheckoutPage({ searchParams: Promise.resolve({ plan: "monthly" }) })).rejects.toThrow("NEXT_NOT_FOUND");
});

test("the installed app has no billing shortcut", () => {
  expect(manifest().shortcuts?.map((shortcut) => shortcut.url)).not.toContain("/billing");
});
