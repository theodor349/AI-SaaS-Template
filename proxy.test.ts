// @vitest-environment node
import { readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { isSignedInPath, SIGNED_IN_ROUTES } from "./lib/auth";
import { withoutUnsafeReturnTo } from "./proxy";

const request = (url: string, host = new URL(url).host) => new Request(url, { headers: { host } });

test("sign-in and sign-up drop return-to URLs that leave the application", () => {
  for (const path of ["/sign-in", "/sign-up", "/sign-in/factor-one"]) {
    const unsafe = withoutUnsafeReturnTo(request(`http://localhost:3000${path}?redirect_url=https%3A%2F%2Fevil.example%2Fapp&other=1`), undefined);
    expect(unsafe?.href).toBe(`http://localhost:3000${path}?other=1`);
  }
  expect(withoutUnsafeReturnTo(request("http://localhost:3000/sign-in?redirect_url=%2Fapp%3Ftab%3Dprofile"), undefined)).toBeNull();
  expect(withoutUnsafeReturnTo(request("http://localhost:3000/sign-in?redirect_url=http%3A%2F%2Flocalhost%3A3000%2Fapp"), undefined)).toBeNull();
  expect(withoutUnsafeReturnTo(request("http://localhost:3000/sign-in"), undefined)).toBeNull();
});

test("other pages keep their query strings", () => {
  for (const path of ["/", "/app", "/sign-inx", "/checkout"]) {
    expect(withoutUnsafeReturnTo(request(`http://localhost:3000${path}?redirect_url=https%3A%2F%2Fevil.example`), undefined)).toBeNull();
  }
});

test("the public origin replaces the loopback listener origin only when the Host matches it", () => {
  const appUrl = "https://app.example.ts.net";
  const evil = "redirect_url=https%3A%2F%2Fevil.example";
  expect(withoutUnsafeReturnTo(request(`http://127.0.0.1:3000/sign-in?${evil}`, "app.example.ts.net"), appUrl)?.href)
    .toBe("https://app.example.ts.net/sign-in");
  expect(withoutUnsafeReturnTo(request("http://127.0.0.1:3000/sign-in?redirect_url=https%3A%2F%2Fapp.example.ts.net%2Fapp", "app.example.ts.net"), appUrl))
    .toBeNull();
  expect(withoutUnsafeReturnTo(request(`http://127.0.0.1:3000/sign-in?${evil}`, "other.example"), appUrl)?.href)
    .toBe("http://127.0.0.1:3000/sign-in");
});

// A route group adds nothing to the URL, so the proxy needs the folder list.
test("every top-level route in app/(protected) sends signed-out visitors to sign-in", () => {
  const routes = readdirSync(new URL("./app/(protected)", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_(]/.test(entry.name))
    .map((entry) => `/${entry.name}`);
  expect([...SIGNED_IN_ROUTES].sort()).toEqual(routes.sort());
});

test("only signed-in routes and their nested paths redirect", () => {
  for (const path of ["/app", "/app/settings", "/account", "/billing", "/checkout"]) expect(isSignedInPath(path), path).toBe(true);
  for (const path of ["/", "/apple-icon", "/application", "/terms", "/sign-in", "/checkouts"]) expect(isSignedInPath(path), path).toBe(false);
});
