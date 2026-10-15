"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ConsentCategory } from "@/lib/consent/categories";
import { CONSENT_COOKIE, parseConsent, readCookie, serializeConsentCookie, type Consent, type ConsentChoices } from "@/lib/consent/cookie";

// Consent lives in a first-party cookie that only the browser reads; reading it on
// the server would make every page dynamic. Before hydration it is unknown (undefined);
// afterwards it is the stored choice, or null when the user has not chosen.
const ConsentContext = createContext<Consent | null | undefined>(undefined);

const listeners = new Set<() => void>();
let cached: { raw: string | undefined; consent: Consent | null } | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab may have changed the choice while this one was hidden.
  document.addEventListener("visibilitychange", listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

function readConsent() {
  const raw = readCookie(document.cookie, CONSENT_COOKIE);
  // useSyncExternalStore needs the same object until the cookie changes.
  if (cached && cached.raw === raw) return cached.consent;
  cached = { raw, consent: parseConsent(raw) };
  return cached.consent;
}

export function saveConsent(choices: ConsentChoices) {
  // Safari caps cookies written by scripts at 7 days, so Safari users are asked again sooner.
  document.cookie = serializeConsentCookie(choices, { secure: window.location.protocol === "https:" });
  for (const listener of listeners) listener();
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const consent = useSyncExternalStore(subscribe, readConsent, () => undefined);
  return <ConsentContext value={consent}>{children}</ConsentContext>;
}

export function useConsentState() {
  return useContext(ConsentContext);
}

// Whether the user granted a category. False until the choice is read after hydration.
export function useConsent(category: ConsentCategory) {
  const consent = useConsentState();
  return category === "essential" || consent?.choices[category] === true;
}
