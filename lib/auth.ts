export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";

// This is an authentication fallback, independent of billing or entitlement.
// Payment onboarding can use it while preserving explicit return-to URLs.
export const AUTHENTICATED_DESTINATION = resolveAuthenticatedDestination(
  process.env.NEXT_PUBLIC_AUTHENTICATED_DESTINATION,
);

export function resolveAuthenticatedDestination(value: string | undefined) {
  if (!value) return "/app";
  const origin = "https://auth-destination.invalid";
  const path = value.startsWith("/") && !value.startsWith("//") ? safeReturnTo(value, origin) : null;
  if (!path || isAuthPath(path.split(/[?#]/)[0])) {
    throw new Error("NEXT_PUBLIC_AUTHENTICATED_DESTINATION must be a local path outside the sign-in and sign-up routes.");
  }
  return path;
}

// True for the sign-in and sign-up pages, including Clerk's nested steps.
export function isAuthPath(pathname: string) {
  return [SIGN_IN_PATH, SIGN_UP_PATH].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// Clerk return-to URLs may be absolute; only this application's origin is allowed.
export function safeReturnTo(value: string, origin: string) {
  if (/[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
