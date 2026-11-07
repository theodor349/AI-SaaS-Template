// @vitest-environment node
import { readdirSync } from "node:fs";
import { type ClerkMiddlewareAuth, clerkMiddleware } from "@clerk/nextjs/server";
import { type NextFetchEvent, NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import { isSignedInPath, SIGNED_IN_ROUTES } from "./lib/auth";
import proxy, { clerkOptions, withoutUnsafeReturnTo } from "./proxy";

// Clerk reads its keys when its modules load. A production key's Account Portal
// fallback would be accounts.app.example.com.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = `pk_live_${btoa("clerk.app.example.com$")}`;
  process.env.CLERK_SECRET_KEY = "sk_live_test";
});

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

test("signed-out visitors go to the app's own sign-in and sign-up pages with the return path", async () => {
  const redirect = async (handler: (auth: ClerkMiddlewareAuth) => Promise<void>) => {
    const response = await clerkMiddleware(handler, clerkOptions)(
      new NextRequest("https://app.example.com/notes?tab=1", { headers: { "sec-fetch-dest": "document" } }),
      {} as NextFetchEvent,
    );
    return response?.headers.get("location");
  };
  const returnTo = `redirect_url=${encodeURIComponent("https://app.example.com/notes?tab=1")}`;
  expect(await redirect(async (auth) => { await auth.protect(); }))
    .toBe(`https://app.example.com/sign-in?${returnTo}`);
  expect(await redirect(async (auth) => (await auth()).redirectToSignUp()))
    .toBe(`https://app.example.com/sign-up?${returnTo}`);
});

const post = (contentType: string, actionId?: string) => proxy(
  new NextRequest("https://app.example.com/index", {
    method: "POST",
    headers: { "content-type": contentType, ...(actionId && { "next-action": actionId }) },
    body: "a=b",
  }),
  {} as NextFetchEvent,
);

test("URL-encoded server action requests get Next's not-found answer instead of a render", async () => {
  // Next renders its not-found tree without the root layout for these, which throws without ClerkProvider.
  for (const contentType of ["application/x-www-form-urlencoded", "Application/X-WWW-Form-Urlencoded; charset=UTF-8"]) {
    const response = await post(contentType, "x");
    expect(response?.status).toBe(404);
    expect(response?.headers.get("content-type")).toBe("text/plain");
    expect(response?.headers.get("x-nextjs-action-not-found")).toBe("1");
    expect(response?.headers.get("content-security-policy")).toBeTruthy();
    expect(await response?.text()).toBe("Server action not found.");
  }
});

test("other POST requests continue to the app", async () => {
  for (const response of [
    await post("application/x-www-form-urlencoded"),
    await post("text/plain;charset=UTF-8", "x"),
    await post("multipart/form-data; boundary=x", "x"),
  ]) {
    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-nextjs-action-not-found")).toBeNull();
  }
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

const visit = (handler: typeof proxy, path: string) => handler(
  new NextRequest(`https://app.example.com${path}`, { headers: { "sec-fetch-dest": "document" } }),
  {} as NextFetchEvent,
);

test("a signed-out visit to a signed-in page redirects to sign-in with the security headers", async () => {
  const response = await visit(proxy, "/billing?plan=yearly");
  expect(response.status).toBe(307);
  expect(response.headers.get("location"))
    .toBe(`https://app.example.com/sign-in?redirect_url=${encodeURIComponent("https://app.example.com/billing?plan=yearly")}`);
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect((await visit(proxy, "/terms")).status).toBe(200);
});

test("maintenance mode skips the sign-in redirect so signed-in pages show the notice", async () => {
  vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_MODE", "1");
  vi.resetModules();
  try {
    const { default: paused } = await import("./proxy");
    expect((await visit(paused, "/billing")).status).toBe(200);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});
