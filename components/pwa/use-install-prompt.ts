"use client";

import { useSyncExternalStore } from "react";
import { markInstallOfferDone } from "@/lib/pwa/install-offer";

// Chromium's install event, which TypeScript's DOM types leave out.
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const listeners = new Set<() => void>();
let deferred: BeforeInstallPromptEvent | null = null;

function notify() {
  for (const listener of listeners) listener();
}

// The browser fires this once it considers the app installable, at most once per page
// load and possibly before React renders, so the listener starts with this module.
// Preventing the default keeps Chrome's own install banner away; the app offers it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function canInstall() {
  return deferred !== null && !matchMedia("(display-mode: standalone)").matches;
}

// Opens the browser's install dialog. Each event allows one dialog; the browser fires
// another later if the user declines. Any answer settles the install offer.
async function install() {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  markInstallOfferDone();
  await event.prompt();
}

// Whether the browser can install the app now, from a regular tab; false on the
// server, in the installed app, and in browsers without the install event.
export function useInstallPrompt() {
  const available = useSyncExternalStore(subscribe, canInstall, () => false);
  return { canInstall: available, install };
}
