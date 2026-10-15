import { describe, expect, test } from "vitest";
import { themeColors, themeScript } from "./theme";

// Runs the inline script the way the browser does: as a standalone string, with only
// browser globals in scope. A reference to anything outside the function fails here.
function runThemeScript({ stored, systemDark, storageBlocked = false }: {
  stored: string | null;
  systemDark: boolean;
  storageBlocked?: boolean;
}) {
  const classes = new Set<string>();
  const root = {
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    style: { colorScheme: "" },
  };
  const head: { children: { name: string; content: string }[]; appendChild: (node: { name: string; content: string }) => void } = {
    children: [],
    appendChild: (node) => head.children.push(node),
  };
  const document = {
    documentElement: root,
    head,
    querySelector: () => head.children[0] ?? null,
    createElement: () => ({ name: "", content: "" }),
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageBlocked) throw new Error("SecurityError");
      return key === "theme" ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && systemDark });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the string is what ships.
  new Function("document", "localStorage", "matchMedia", themeScript)(document, localStorage, matchMedia);
  return { dark: classes.has("dark"), colorScheme: root.style.colorScheme, themeColor: head.children.map((meta) => meta.content) };
}

describe("theme script", () => {
  test("an explicit choice overrides the OS theme", () => {
    expect(runThemeScript({ stored: "dark", systemDark: false })).toEqual({ dark: true, colorScheme: "dark", themeColor: [themeColors.dark] });
    expect(runThemeScript({ stored: "light", systemDark: true })).toEqual({ dark: false, colorScheme: "light", themeColor: [themeColors.light] });
  });

  test("no choice, an unknown value, or blocked storage follows the OS theme", () => {
    expect(runThemeScript({ stored: null, systemDark: true }).dark).toBe(true);
    expect(runThemeScript({ stored: "sepia", systemDark: true }).dark).toBe(true);
    expect(runThemeScript({ stored: null, systemDark: false }).dark).toBe(false);
    expect(runThemeScript({ stored: "dark", systemDark: true, storageBlocked: true }).dark).toBe(true);
    expect(runThemeScript({ stored: "dark", systemDark: false, storageBlocked: true }).dark).toBe(false);
  });
});
