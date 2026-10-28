// @vitest-environment happy-dom
import { act } from "react";
import { expect, test } from "vitest";
import { THEME_STORAGE_KEY, themeColors } from "@/lib/theme";
import { render } from "@/tests/component/render";
import { ThemeSync } from "./theme-sync";

test("a choice in one tab updates the other tabs", () => {
  render(<ThemeSync />);
  expect(document.documentElement.classList.contains("dark")).toBe(false);

  // Another tab stored the choice; the browser tells this one with a storage event.
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }));
  });
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(themeColors.dark);
});
