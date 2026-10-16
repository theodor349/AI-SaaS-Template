import { describe, expect, it, vi } from "vitest";
import { createOverlayHistory } from "./overlay-history";

type Entry = { url: string; state: Record<string, unknown> | null };

// A session history whose traversals land asynchronously, like a browser's. The router
// listener stands in for Next.js, which registers after the overlay history.
function browser(entries: Entry[] = [{ url: "https://app.test/account", state: { __NA: true } }]) {
  const target = new EventTarget();
  let index = entries.length - 1;
  const location = { get href() { return entries[index].url; } };
  const history = {
    get state() { return entries[index].state; },
    pushState(state: Entry["state"], _unused: string, next?: string | URL | null) {
      entries.splice(index + 1);
      entries.push({ url: next ? new URL(next, location.href).href : location.href, state: structuredClone(state) });
      index++;
    },
    replaceState(state: Entry["state"], _unused: string, next?: string | URL | null) {
      entries[index] = { url: next ? new URL(next, location.href).href : location.href, state: structuredClone(state) };
    },
    go(delta: number) {
      setTimeout(() => {
        index = Math.min(Math.max(index + delta, 0), entries.length - 1);
        target.dispatchEvent(new Event("popstate"));
      });
    },
  };
  const win = { history, location, addEventListener: target.addEventListener.bind(target) } as unknown as Window;
  const overlays = createOverlayHistory(win);
  const router = vi.fn();
  target.addEventListener("popstate", router);
  return {
    overlays,
    router,
    history: win.history,
    back: () => history.go(-1),
    forward: () => history.go(1),
    get urls() { return entries.map((entry) => new URL(entry.url).pathname); },
    get index() { return index; },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("overlay history", () => {
  it("closes the top overlay on back and keeps the page", async () => {
    const page = browser();
    const closeMenu = vi.fn();
    const closeDialog = vi.fn();
    page.overlays.open(closeMenu);
    page.overlays.open(closeDialog);

    page.back();
    await settle();
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(closeMenu).not.toHaveBeenCalled();

    page.back();
    await settle();
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(page.index).toBe(0);
    expect(page.urls[page.index]).toBe("/account");
  });

  it("removes the entry of an overlay closed in the page without telling the router", async () => {
    const page = browser();
    const release = page.overlays.open(vi.fn());
    release();
    await settle();

    expect(page.index).toBe(0);
    expect(page.router).not.toHaveBeenCalled();
  });

  it("moves the entry to an overlay that opens as another closes", async () => {
    const page = browser();
    const closeMenu = vi.fn();
    const closeDialog = vi.fn();
    const releaseMenu = page.overlays.open(closeMenu);
    await settle();
    releaseMenu();
    page.overlays.open(closeDialog);
    await settle();
    expect(page.index).toBe(1);

    page.back();
    await settle();
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(page.index).toBe(0);
    expect(closeMenu).not.toHaveBeenCalled();
  });

  it("lands a navigation that follows a close on the page's entry", async () => {
    const page = browser();
    const release = page.overlays.open(vi.fn());
    await settle();
    release();
    page.history.pushState({ __NA: true }, "", "/billing");
    await settle();

    expect(page.urls).toEqual(["/account", "/billing"]);
    expect(page.index).toBe(1);
    expect(page.router).not.toHaveBeenCalled();
  });

  it("replaces the entries of overlays still open during a navigation and closes them", async () => {
    const page = browser();
    const close = vi.fn();
    page.overlays.open(close);
    await settle();
    page.history.pushState({ __NA: true }, "", "/");
    await settle();

    expect(close).toHaveBeenCalledOnce();
    expect(page.urls).toEqual(["/account", "/"]);
    expect(page.index).toBe(1);
    page.back();
    await settle();
    expect(page.urls[page.index]).toBe("/account");
    expect(page.router).toHaveBeenCalledOnce();
  });

  it("keeps an overlay's entry when the page rewrites its state", async () => {
    const page = browser();
    const release = page.overlays.open(vi.fn());
    await settle();
    page.history.replaceState({ __NA: true }, "", "/account");
    release();
    await settle();

    expect(page.index).toBe(0);
    expect(page.router).not.toHaveBeenCalled();
  });

  it("replaces the page's entry when the page replaces its URL while an overlay is open", async () => {
    const page = browser([{ url: "https://app.test/", state: null }, { url: "https://app.test/checkout", state: { __NA: true } }]);
    const close = vi.fn();
    page.overlays.open(close);
    await settle();
    page.history.replaceState({ __NA: true }, "", "/billing");
    await settle();

    expect(close).toHaveBeenCalledOnce();
    expect(page.urls).toEqual(["/", "/billing", "/checkout"]);
    expect(page.index).toBe(1);
  });

  it("steps past an overlay entry left by a reload", async () => {
    const url = "https://app.test/account";
    const page = browser([{ url, state: { __NA: true } }, { url, state: { __NA: true, __overlay: "earlier:1" } }]);
    await settle();

    expect(page.index).toBe(0);
    expect(page.router).not.toHaveBeenCalled();
  });
});
