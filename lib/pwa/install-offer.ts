// Essential per-browser storage: "done" once the user dismisses or answers the
// install offer, so it never comes back.
export const INSTALL_OFFER_STORAGE_KEY = "install-offer";

// Clerk creates the first session together with the account, so a session started
// within this long of the account is the one sign-up created.
const SIGN_UP_SESSION_WINDOW_MS = 60_000;

export function isSignUpSession(userCreatedAt: Date | null, sessionCreatedAt: Date) {
  return userCreatedAt !== null && Math.abs(sessionCreatedAt.getTime() - userCreatedAt.getTime()) <= SIGN_UP_SESSION_WINDOW_MS;
}

// Covers browsers that refuse storage until the page reloads.
let doneInThisPage = false;

export function installOfferDone() {
  if (doneInThisPage) return true;
  try {
    return localStorage.getItem(INSTALL_OFFER_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function markInstallOfferDone() {
  doneInThisPage = true;
  try {
    localStorage.setItem(INSTALL_OFFER_STORAGE_KEY, "done");
  } catch {}
}
