import { defineShortcut } from "@/lib/pwa/assets";

// Listed in app/manifest.ts.
export const billingShortcut = defineShortcut({ name: "Billing", url: "/billing" });
