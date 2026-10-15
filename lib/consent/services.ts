// Every service that stores data in the visitor's browser, with the storage it
// uses. The cookie policy's table and optional sections are generated from this
// list, so add a service here when it starts storing anything.
export type ConsentCategory = "essential" | "analytics";

export type BrowserStorage = {
  name: string;
  kind: "Cookie" | "Local storage" | "Session storage";
  purpose: string;
  duration: string;
};

export type BrowserService = {
  id: string;
  name: string;
  // The company that sets the storage, or "app" for this app's own storage.
  provider: string;
  category: ConsentCategory;
  purpose: string;
  storage: BrowserStorage[];
};

export const browserServices: BrowserService[] = [
  {
    id: "clerk",
    name: "Clerk",
    provider: "Clerk",
    category: "essential",
    purpose: "Keeps you signed in and protects your account.",
    storage: [
      { name: "__session", kind: "Cookie", purpose: "Short-lived token that proves you are signed in.", duration: "Until it is refreshed, about 1 minute" },
      { name: "__client_uat", kind: "Cookie", purpose: "Records when you last signed in or out, so the server knows whether to check your session.", duration: "Up to 1 year" },
      { name: "__refresh", kind: "Cookie", purpose: "Lets the session token refresh across page loads.", duration: "Session" },
      { name: "__clerk_handshake", kind: "Cookie", purpose: "Passes your session to the app while you sign in.", duration: "A few seconds" },
      { name: "__client", kind: "Cookie", purpose: "Keeps you signed in on Clerk's sign-in domain.", duration: "Until you sign out or the session expires" },
    ],
  },
];
