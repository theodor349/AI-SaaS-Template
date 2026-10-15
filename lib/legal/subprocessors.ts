// The providers that process personal data for the app, listed in the privacy
// policy. Check each provider's status when adding one or changing its region:
// the Data Privacy Framework list is at https://www.dataprivacyframework.gov/list.
export type Subprocessor = {
  name: string;
  entity: string;
  purpose: string;
  location: string;
  safeguard: string;
  privacyUrl: string;
};

const dataPrivacyFramework = "EU–US Data Privacy Framework, with standard contractual clauses as a fallback";
const standardContractualClauses = "Standard contractual clauses";

export const subprocessors: Subprocessor[] = [
  {
    name: "Clerk",
    entity: "Clerk, Inc.",
    purpose: "Sign-in, sessions, and your account profile",
    location: "United States",
    safeguard: dataPrivacyFramework,
    privacyUrl: "https://clerk.com/legal/privacy",
  },
  {
    name: "Convex",
    entity: "Convex, Inc.",
    purpose: "Database and backend for your application data",
    location: "United States",
    safeguard: standardContractualClauses,
    privacyUrl: "https://www.convex.dev/legal/privacy",
  },
  {
    name: "Polar",
    entity: "Polar Software, Inc.",
    purpose: "Checkout, payments, invoices, and subscriptions, as merchant of record",
    location: "United States",
    safeguard: standardContractualClauses,
    privacyUrl: "https://polar.sh/legal/privacy-policy",
  },
  {
    name: "Vercel",
    entity: "Vercel Inc.",
    purpose: "Hosting the website and handling requests",
    location: "United States",
    safeguard: dataPrivacyFramework,
    privacyUrl: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Sentry",
    entity: "Functional Software, Inc.",
    purpose: "Error monitoring",
    location: "United States",
    safeguard: dataPrivacyFramework,
    privacyUrl: "https://sentry.io/privacy/",
  },
];
