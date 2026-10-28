// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { ThemeSync } from "@/components/theme/theme-sync";
import { applyTheme, THEME_STORAGE_KEY, themeColors } from "@/lib/theme";
import { click, getByRole, render } from "@/tests/component/render";
import { ThemePreference } from "./theme-preference";

test("a choice the browser refuses to store still applies and says it won't last", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  const { container } = render(<><ThemePreference /><ThemeSync /></>);

  await click(getByRole("radio", "Dark"));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(getByRole("radio", "Dark").getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("couldn’t save your choice");

  // A reload runs the inline theme script, which finds nothing stored.
  applyTheme(THEME_STORAGE_KEY, themeColors);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});
