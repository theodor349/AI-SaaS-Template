import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

// Renders components into happy-dom for tests in files that start with
// `// @vitest-environment happy-dom`. Each test's render is unmounted after it.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

export function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(ui));
  return {
    container,
    unmount: () => act(() => root.unmount()),
  };
}

// The text a screen reader announces for `element`: its aria-label, or its text
// without hidden parts, such as the idle label of a pending ButtonLabel.
function accessibleName(element: Element) {
  const label = element.getAttribute("aria-label");
  if (label) return label;
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent?.trim() ?? "";
}

/** Every element in the document with `role` and the accessible name `name`. */
export function queryAllByRole(role: string, name: string | RegExp) {
  const selector = role === "button" ? 'button, [role="button"]' : `[role="${role}"]`;
  return [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
    const actual = accessibleName(element);
    return typeof name === "string" ? actual === name : name.test(actual);
  });
}

/** The one element with `role` and `name`, or null. */
export function queryByRole(role: string, name: string | RegExp) {
  const matches = queryAllByRole(role, name);
  if (matches.length > 1) throw new Error(`${matches.length} ${role} elements are named ${name}`);
  return matches[0] ?? null;
}

export function getByRole(role: string, name: string | RegExp) {
  const element = queryByRole(role, name);
  if (!element) throw new Error(`No ${role} is named ${name}. The document reads: ${document.body.textContent}`);
  return element;
}

/** Clicks `element` and lets the work it starts settle. */
export async function click(element: HTMLElement) {
  await act(async () => element.click());
}

/** Lets pending promises and the renders they cause settle. */
export async function settle() {
  await act(async () => {});
}

/** Retries `assertion` until it passes, for work behind real timers such as toast animations. */
export async function waitFor(assertion: () => void, timeout = 1_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    }
  }
}
