// The consent categories users choose between. Essential is always on; every other
// category is off until the user grants it. Adding a category (marketing, say) is a
// policy change, so bump CONSENT_POLICY_VERSION in ./cookie.ts with it.
export const consentCategories = {
  essential: {
    label: "Essential",
    description: "Keep you signed in, protect your account, and remember your cookie and theme choices. Always on.",
  },
  analytics: {
    label: "Analytics",
    description: "Help us find and fix errors and slow pages.",
  },
} satisfies Record<string, { label: string; description: string }>;

export type ConsentCategory = keyof typeof consentCategories;
export type OptionalCategory = Exclude<ConsentCategory, "essential">;

export const optionalCategories = Object.keys(consentCategories)
  .filter((category): category is OptionalCategory => category !== "essential");
