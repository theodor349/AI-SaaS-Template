// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PaidBoundary } from "./paid-boundary";

const backend = vi.hoisted(() => ({
  auth: { isLoading: true, isAuthenticated: false },
  status: undefined as { readiness: string; state: string; paidThrough: number | null } | undefined,
  queried: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => backend.auth,
  useQuery: (_query: unknown, args: unknown) => {
    backend.queried.push(args);
    return args === "skip" ? undefined : backend.status;
  },
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/convex", () => ({ useAction: () => vi.fn() }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  backend.auth = { isLoading: true, isAuthenticated: false };
  backend.status = undefined;
  backend.queried = [];
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
  act(() => root.render(<PaidBoundary><p>Notes</p></PaidBoundary>));
}

const status = () => container.querySelector("[role=status]:not([aria-hidden=true])")?.textContent;
const spinner = () => container.querySelector("[data-slot=spinner]");

test("keeps one spinner in place from connecting the account to checking paid access", () => {
  render({});
  expect(status()).toBe("Connecting your account…");
  expect(backend.queried).toEqual(["skip"]);
  const first = spinner();
  expect(first).not.toBeNull();

  render({ auth: { isLoading: false, isAuthenticated: true } });
  expect(status()).toBe("Checking paid access…");
  expect(spinner()).toBe(first);

  render({ status: { readiness: "ready", state: "active", paidThrough: null } });
  expect(container.textContent).toBe("Notes");
});

test("sends a deleting account to the account page and an unpaid one to billing", () => {
  render({ auth: { isLoading: false, isAuthenticated: true }, status: { readiness: "deleting", state: "active", paidThrough: null } });
  expect(router.replace).toHaveBeenLastCalledWith("/account");

  render({ status: { readiness: "ready", state: "ended", paidThrough: null } });
  expect(status()).toBe("Checking paid access…");
  expect(router.replace).toHaveBeenLastCalledWith("/billing");
  expect(router.replace).toHaveBeenCalledTimes(2);
});
