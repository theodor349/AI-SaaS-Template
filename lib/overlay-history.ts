// Each open overlay (dialog, alert dialog, menu) owns one history entry above the
// page's entry, so Android's back gesture and the browser's back button close the top
// overlay and keep the page. See docs/internals/overlay-history.md.

const KEY = "__overlay";

type Overlay = { id: string; close: () => void; closed: boolean };
type HistoryWindow = Pick<Window, "history" | "location" | "addEventListener">;

export function createOverlayHistory(win: HistoryWindow) {
  const { history, location } = win;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  // Entries survive reloads, so ids carry a per-load prefix.
  const load = Math.random().toString(36).slice(2);
  let count = 0;
  // Overlays whose entries sit above the page's entry, oldest first.
  let overlays: Overlay[] = [];
  // Set while a step back of ours is in flight. History writes wait for it to land, so
  // they apply to the page's entry instead of racing the traversal.
  let landing: string | null = null;
  const waiting: (() => void)[] = [];

  const currentId = () => (history.state as Record<string, unknown> | null)?.[KEY];

  function stepBack(steps: number) {
    landing = location.href;
    history.go(-steps);
  }

  function write(apply: () => void) {
    if (landing === null) apply();
    else waiting.push(apply);
  }

  // Removes the entries of closed overlays at the top while they are still current.
  function trim() {
    let steps = 0;
    while (steps < overlays.length && overlays[overlays.length - 1 - steps].closed) steps++;
    if (!steps) return;
    const top = overlays[overlays.length - 1];
    overlays = overlays.slice(0, -steps);
    if (currentId() === top.id) stepBack(steps);
  }

  // Wraps a history write so it accounts for overlay entries that are current.
  const writer = (apply: typeof push, kind: "push" | "replace"): typeof push => (data, unused, url) => write(() => {
    const top = overlays[overlays.length - 1];
    if (!top || currentId() !== top.id) {
      apply(data, unused, url);
      return;
    }
    if (url == null || new URL(url, location.href).href === location.href) {
      // Rewriting the state of the overlay's entry, as the router does on a refresh,
      // keeps it the overlay's.
      apply(kind === "replace" ? { ...(data as object | null), [KEY]: top.id } : data, unused, url);
      return;
    }
    // A page navigation takes the place of the overlays' entries and closes them.
    // The router calls this while committing, so the closes wait for a microtask.
    const open = overlays.filter((overlay) => !overlay.closed);
    stepBack(overlays.length);
    overlays = [];
    waiting.unshift(() => apply(data, unused, url));
    queueMicrotask(() => open.reverse().forEach((overlay) => overlay.close()));
  });
  history.pushState = writer(push, "push");
  history.replaceState = writer(replace, "replace");

  // Capture runs this before Next.js's own listener.
  win.addEventListener("popstate", (event) => {
    if (landing !== null) {
      // Our own step back. Next.js would treat it as a back navigation and discard any
      // navigation in progress, so it never sees one that stays on the same URL.
      if (location.href === landing) event.stopImmediatePropagation();
      landing = null;
      // A reload keeps a closed overlay's entry; step past it to the page.
      if (!overlays.length && currentId()) stepBack(1);
      trim();
      while (landing === null && waiting.length) waiting.shift()!();
      return;
    }
    // The user went back: close the overlays whose entries are now ahead.
    const index = overlays.findIndex((overlay) => overlay.id === currentId());
    const ahead = overlays.slice(index + 1).reverse();
    overlays = overlays.slice(0, index + 1);
    for (const overlay of ahead) if (!overlay.closed) overlay.close();
    trim();
  }, { capture: true });

  if (currentId()) stepBack(1);

  // Adds an entry for an overlay that just opened. `close` closes it when the user goes
  // back; the returned function removes the entry when the overlay closes another way.
  function open(close: () => void) {
    const overlay: Overlay = { id: `${load}:${++count}`, close, closed: false };
    write(() => {
      if (overlay.closed) return;
      push({ ...(history.state as object | null), [KEY]: overlay.id }, "");
      overlays.push(overlay);
    });
    return () => {
      if (overlay.closed) return;
      overlay.closed = true;
      if (landing === null) trim();
    };
  }

  return { open };
}

export const overlayHistory = typeof history === "undefined" ? null : createOverlayHistory(window);
