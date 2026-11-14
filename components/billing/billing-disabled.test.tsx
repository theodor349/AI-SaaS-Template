// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import manifest from "@/app/manifest";
import ApplicationLayout from "@/app/(protected)/app/layout";
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
// A user with no billing account whose last plan ran out.
const account = vi.hoisted((): { status?: { readiness: string; state: string; paidThrough: number } } => ({
  status: { readiness: "ready", state: "ended", paidThrough: Date.now() - 1000 },
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useQuery: () => account.status,
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }) }));
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

test("the app's loading screen never mentions payment", () => {
  account.status = undefined;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ApplicationLayout><p>Notes</p></ApplicationLayout>));
  expect(container.querySelector("[role=status]:not([aria-hidden=true])")?.textContent).toBe("Loading your account…");
  expect(container.textContent).not.toMatch(/paid|plan|billing|payment/i);
  act(() => root.unmount());
});

test("billing and checkout pages are not found", () => {
  expect(() => BillingPage()).toThrow("NEXT_NOT_FOUND");
  expect(() => CheckoutPage()).toThrow("NEXT_NOT_FOUND");
});

test("the installed app has no billing shortcut", () => {
  expect(manifest().shortcuts?.map((shortcut) => shortcut.url)).not.toContain("/billing");
});
