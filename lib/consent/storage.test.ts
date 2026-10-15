import { afterEach, expect, test, vi } from "vitest";
import { clearConsentStorage } from "./storage";

afterEach(() => vi.unstubAllGlobals());

test("blocked web storage does not stop the remaining entries from being cleared", () => {
  const removed: string[] = [];
  vi.stubGlobal("window", {
    get localStorage(): never { throw new DOMException("The operation is insecure.", "SecurityError"); },
    sessionStorage: { removeItem: (name: string) => removed.push(name) },
  });
  clearConsentStorage([
    { name: "blocked", type: "localStorage", purpose: "", duration: "" },
    { name: "cleared", type: "sessionStorage", purpose: "", duration: "" },
  ]);
  expect(removed).toEqual(["cleared"]);
});
