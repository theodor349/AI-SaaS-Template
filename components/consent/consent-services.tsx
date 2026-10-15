"use client";

import { useEffect } from "react";
import { createConsentRunner } from "@/lib/consent/runner";
import { consentServices } from "@/lib/consent/services";
import { clearConsentStorage } from "@/lib/consent/storage";
import { useConsentState } from "./consent-provider";

// One runner per page lifetime, outside React, so a remount cannot load a service twice.
const runner = createConsentRunner(consentServices, clearConsentStorage);

// Rendered once in the root layout: loads and unloads services as consent changes.
export function ConsentServices() {
  const consent = useConsentState();
  useEffect(() => {
    if (consent !== undefined) void runner.sync(consent);
  }, [consent]);
  return null;
}
