// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AccountBoundary } from "./account-boundary";

// A free app: `billing: false` in app.config.ts.
vi.mock("@/app.config", async (importOriginal) => {
  const { appConfig } = await importOriginal<typeof import("@/app.config")>();
  return { appConfig: { ...appConfig, billing: false } };
});
const backend = vi.hoisted(() => ({
  auth: { isLoading: true, isAuthenticated: false },
  status: undefined as { readiness: string; state: string; paidThrough: number | null } | undefined,
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => backend.auth,
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : backend.status),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  backend.auth = { isLoading: false, isAuthenticated: true };
  backend.status = undefined;
  router.replace.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(state: Partial<typeof backend>) {
  Object.assign(backend, state);
  act(() => root.render(<AccountBoundary><p>Notes</p></AccountBoundary>));
}

const status = () => container.querySelector("[role=status]:not([aria-hidden=true])")?.textContent;
const spinner = () => container.querySelector("[data-slot=spinner]");

test("waits with one spinner from connecting the account until it is ready", () => {
  render({ auth: { isLoading: true, isAuthenticated: false } });
  expect(status()).toBe("Connecting your account…");
  const first = spinner();
  expect(first).not.toBeNull();

  render({ auth: { isLoading: false, isAuthenticated: true } });
  expect(status()).toBe("Loading your account…");
  expect(spinner()).toBe(first);

  render({ status: { readiness: "provisioning", state: "awaiting_payment", paidThrough: null } });
  expect(status()).toBe("Loading your account…");
  expect(container.textContent).not.toMatch(/paid|plan|billing|payment/i);

  render({ status: { readiness: "ready", state: "ended", paidThrough: null } });
  expect(container.textContent).toBe("Notes");
  expect(router.replace).not.toHaveBeenCalled();
});

test("sends an account that is being deleted to the account page", () => {
  render({ status: { readiness: "deleting", state: "active", paidThrough: null } });
  expect(container.textContent).not.toContain("Notes");
  expect(router.replace).toHaveBeenCalledWith("/account");
});
