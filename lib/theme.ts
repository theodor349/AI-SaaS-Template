export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Essential per-browser storage: holds "light" or "dark"; absent means system.
export const THEME_STORAGE_KEY = "theme";

// The `--background` of each theme in app/globals.css as hex, which every browser
// accepts for `theme-color`. The PWA manifest should use the same values.
export const themeColors = { light: "#ffffff", dark: "#090b0c" } satisfies Record<ResolvedTheme, string>;

export function parseThemePreference(stored: string | null): ThemePreference {
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

// Applies `choice`, or the stored choice when it is left out, to the document. It also
// runs as an inline script before first paint (see `themeScript`), so it must not
// reference anything outside itself.
export function applyTheme(storageKey: string, colors: Record<ResolvedTheme, string>, choice?: string | null) {
  let stored = choice;
  if (stored === undefined) {
    try {
      stored = localStorage.getItem(storageKey);
    } catch {}
  }
  const dark = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = dark ? colors.dark : colors.light;
}

export const themeScript = `(${applyTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)}, ${JSON.stringify(themeColors)})`;
