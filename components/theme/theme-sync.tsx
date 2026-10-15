"use client";

import { useEffect } from "react";
import { applyStoredTheme, THEME_STORAGE_KEY, themeColors } from "@/lib/theme";
import { useResolvedTheme } from "./use-theme";

// Keeps the document in step with the theme after the inline script set it before
// first paint: a new choice, a choice in another tab, or an OS change under System.
// Render once, in the root layout.
export function ThemeSync() {
  const resolved = useResolvedTheme();

  useEffect(() => {
    if (!resolved || document.documentElement.classList.contains("dark") === (resolved === "dark")) return;
    // Suspend transitions so every element switches in the same frame instead of
    // fading at its own speed.
    const pause = document.createElement("style");
    pause.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(pause);
    applyStoredTheme(THEME_STORAGE_KEY, themeColors);
    void getComputedStyle(document.body).color;
    const restore = setTimeout(() => pause.remove(), 1);
    return () => {
      clearTimeout(restore);
      pause.remove();
    };
  }, [resolved]);

  return null;
}
