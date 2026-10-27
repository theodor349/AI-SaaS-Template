// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthBoundary } from "./auth-boundary";

const auth = vi.hoisted(() => ({
  clerk: { isLoaded: true, isSignedIn: true },
  convex: { isLoading: false, isAuthenticated: true, isRefreshing: false },
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth.clerk, SignInButton: () => null }));
vi.mock("convex/react", () => ({ useConvexAuth: () => auth.convex }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  auth.convex = { isLoading: false, isAuthenticated: true, isRefreshing: false };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Stands in for a half-filled form: its state is lost if the boundary unmounts it.
function Draft() {
  const [edits, setEdits] = useState(0);
  return <button onClick={() => setEdits(edits + 1)}>{edits} edits</button>;
}

function render(convex: Partial<typeof auth.convex>) {
  auth.convex = { ...auth.convex, ...convex };
  act(() => root.render(<AuthBoundary><Draft /></AuthBoundary>));
}

function editDraft() {
  act(() => container.querySelector("button")?.click());
}

test("keeps loaded content and its state while Convex refreshes an expired token", () => {
  render({});
  editDraft();

  render({ isRefreshing: true });
  expect(container.textContent).toBe("1 edits");

  render({ isRefreshing: false });
  expect(container.textContent).toBe("1 edits");
});

test("shows the pending state while Convex auth is loading", () => {
  render({ isLoading: true, isAuthenticated: false });
  expect(container.textContent).toBe("Connecting your account…");

  render({ isLoading: false, isAuthenticated: true });
  expect(container.textContent).toBe("0 edits");
});

test("offers recovery when reauthentication fails", () => {
  render({});
  render({ isAuthenticated: false });
  expect(container.textContent).toContain("We couldn’t load your account");
});
