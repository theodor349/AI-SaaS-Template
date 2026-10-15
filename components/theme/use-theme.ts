"use client";

import { useSyncExternalStore } from "react";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

// Notifies on choices in this tab, choices in other tabs, and OS theme changes.
function subscribe(onChange: () => void) {
  const media = matchMedia(DARK_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onChange);
  };
}

function readPreference() {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
  for (const listener of listeners) listener();
}

// The stored choice for this browser; `undefined` while server rendering and hydrating.
export function useThemePreference() {
  return useSyncExternalStore(subscribe, readPreference, () => undefined);
}

// The theme in effect; `undefined` while server rendering and hydrating.
export function useResolvedTheme() {
  return useSyncExternalStore(
    subscribe,
    () => resolveTheme(readPreference(), matchMedia(DARK_QUERY).matches),
    () => undefined,
  );
}
