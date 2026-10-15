import type { CspOrigins } from "@/lib/security/csp";
import { consentCategories, type ConsentCategory } from "./categories";

export type ConsentStorage = {
  name: string;
  type: "cookie" | "localStorage" | "sessionStorage" | "cacheStorage";
  purpose: string;
  duration: string;
};

export type ConsentService = {
  id: string;
  category: ConsentCategory;
  // Who provides the service; the cookie table's provider column.
  name: string;
  purpose: string;
  // Everything the service stores in the browser. The cookie table lists it, and
  // first-party entries are cleared when the user withdraws the category.
  storage: readonly ConsentStorage[];
  // Third-party origins the service loads code from or sends data to. The Content
  // Security Policy allows them on every page, whether or not the category is granted.
  origins?: CspOrigins;
  // Called in the browser once the category is granted, and again after a later
  // re-grant. Import the service's code dynamically here so nobody downloads it
  // before agreeing. Essential services leave both out.
  load?: () => void | Promise<void>;
  // Called when the category is withdrawn, after any pending load finishes, and
  // after a load that throws, so it must tolerate a partial load.
  unload?: () => void | Promise<void>;
};

// Add a new service by defining it with this and adding it to consentServices in ./services.ts.
export function defineConsentService<const Service extends ConsentService>(service: Service) {
  return service;
}

// Each category with the services in it, in category order, for the preferences dialog.
export function servicesByCategory(services: readonly ConsentService[]) {
  return (Object.keys(consentCategories) as ConsentCategory[]).map((category) => ({
    category,
    ...consentCategories[category],
    services: services.filter((service) => service.category === category),
  }));
}
