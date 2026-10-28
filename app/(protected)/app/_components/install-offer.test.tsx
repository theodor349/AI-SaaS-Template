// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appConfig } from "@/app.config";
import { Toaster } from "@/components/ui/sonner";
import { click, getByRole, queryByRole, render, waitFor } from "@/tests/component/render";

const clerk = vi.hoisted(() => {
  // A session started together with the account, as sign-up starts one.
  const createdAt = new Date();
  return { user: { createdAt, imageUrl: "", primaryEmailAddress: null }, session: { createdAt } };
});
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: clerk.user }),
  useSession: () => ({ session: clerk.session }),
  useClerk: () => ({ signOut: async () => {} }),
}));
vi.mock("convex/react", () => import("@/tests/component/fake-convex"));

let dialogs: number;

beforeEach(() => {
  dialogs = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Loads the install code as a new page load does, without the page's install
// event or the choices it remembers outside storage.
async function openPage() {
  vi.resetModules();
  const { InstallOffer } = await import("./install-offer");
  const { ProfileMenu } = await import("@/components/layout/profile-menu");
  return render(<><InstallOffer /><ProfileMenu /><Toaster closeButton /></>);
}

// Chrome fires beforeinstallprompt once the app is installable; the test stands in for it.
function becomeInstallable() {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: async () => {
      dialogs++;
    },
    userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

function offer() {
  return [...document.querySelectorAll("[data-sonner-toast]")]
    .find((toast) => toast.textContent?.includes(`Install ${appConfig.appName}`)) ?? null;
}

// Sonner adds and removes toasts on later timer ticks, so check again after one.
async function expectOfferShown(shown: boolean) {
  await waitFor(() => expect(offer() !== null).toBe(shown));
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(offer() !== null).toBe(shown);
}

function openMenu() {
  act(() => {
    getByRole("button", "Open profile menu").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

function closeMenu() {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

function menuOffersInstall() {
  openMenu();
  getByRole("menuitem", "Account");
  const offered = queryByRole("menuitem", "Install app") !== null;
  closeMenu();
  return offered;
}

test("the install offer appears once after sign-up and the profile menu keeps offering install", async () => {
  const page = await openPage();
  becomeInstallable();
  await expectOfferShown(true);
  await click(offer()!.querySelector<HTMLElement>('[aria-label="Close toast"]')!);
  await expectOfferShown(false);

  page.unmount();
  await openPage();
  becomeInstallable();
  expect(menuOffersInstall()).toBe(true);
  await expectOfferShown(false);

  openMenu();
  await click(getByRole("menuitem", "Install app"));
  expect(dialogs).toBe(1);
  // Each event allows one dialog, so the menu waits for the browser's next one.
  expect(menuOffersInstall()).toBe(false);
});

test("installing from the profile menu while the offer shows closes the offer", async () => {
  await openPage();
  becomeInstallable();
  await expectOfferShown(true);

  openMenu();
  await click(getByRole("menuitem", "Install app"));
  expect(dialogs).toBe(1);
  await expectOfferShown(false);
});

test("installing from the offer opens the browser's dialog, and the installed app never offers", async () => {
  const page = await openPage();
  becomeInstallable();
  await expectOfferShown(true);
  await click(getByRole("button", "Install app"));
  expect(dialogs).toBe(1);
  await expectOfferShown(false);

  // The same account in the installed app, before it ever answered the offer.
  page.unmount();
  localStorage.clear();
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query === "(display-mode: standalone)" ? { ...matchMedia(query), matches: true } : matchMedia(query));
  await openPage();
  becomeInstallable();
  expect(menuOffersInstall()).toBe(false);
  await expectOfferShown(false);
});
