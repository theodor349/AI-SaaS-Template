import { readFileSync } from "node:fs";
import path from "node:path";
import { appConfig, type AppConfig } from "../../app.config";
import { consentCategories } from "../consent/categories";
import type { ConsentService, ConsentStorage } from "../consent/service";
import { consentServices } from "../consent/services";
import { searchIndexingAllowed } from "../seo";
import { subprocessors } from "./subprocessors";
import { markdownTable, parseFrontMatter, renderTemplate } from "./template";

export const legalSlugs = ["privacy", "terms", "cookies"] as const;
export type LegalSlug = (typeof legalSlugs)[number];

const contentDirectory = path.join(process.cwd(), "content", "legal");
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

function effectiveDate(value: string | undefined) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
    throw new Error(`Legal document needs an effective date as YYYY-MM-DD, got ${value}`);
  }
  return dateFormat.format(date);
}

function version(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Legal document needs a positive integer version, got ${value}`);
  return parsed;
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`Legal document needs a ${name}`);
  return value;
}

const storageTypes: Record<ConsentStorage["type"], string> = {
  cookie: "cookie",
  localStorage: "local storage",
  sessionStorage: "session storage",
};

const analyticsServices = consentServices.filter((service) => service.category === "analytics");

// One row per stored item. A service that stores nothing still gets a row, so
// the table lists every service the consent registry can load.
function cookieRows(service: ConsentService) {
  const category = consentCategories[service.category].label;
  if (service.storage.length === 0) {
    return [["None", service.name, category, `${service.purpose} Stores nothing in your browser.`, "Not applicable"]];
  }
  return service.storage.map((storage) => [
    `\`${storage.name}\` (${storageTypes[storage.type]})`, service.name, category, storage.purpose, storage.duration,
  ]);
}

const blocks = {
  "cookie-table": markdownTable(["Name", "Provider", "Category", "Purpose", "Duration"], consentServices.flatMap(cookieRows)),
  "analytics-services": analyticsServices.map((service) => `- **${service.name}:** ${service.purpose}`).join("\n"),
  subprocessors: markdownTable(
    ["Provider", "What they do for us", "Where", "Transfer safeguard"],
    subprocessors.map((processor) => [
      `[${processor.name}](${processor.privacyUrl}) (${processor.entity})`,
      processor.purpose,
      processor.location,
      processor.safeguard,
    ]),
  ),
};

// The template's example company details. Other builds may show them, but the
// public production deployment must publish the real operator.
const exampleCompany = { companyCvr: "00000000", companyAddress: "Example Street 1, 8000 Aarhus C, Denmark" };

// Pages call this while prerendering, so NEXT_PUBLIC_APP_URL must be set for every build.
export function loadLegalDocument(slug: LegalSlug, options: { config?: AppConfig; appUrl?: string; publicProduction?: boolean } = {}) {
  const { config = appConfig, appUrl = process.env.NEXT_PUBLIC_APP_URL, publicProduction = searchIndexingAllowed() } = options;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is required to render the legal documents");
  if (publicProduction && (config.companyCvr === exampleCompany.companyCvr || config.companyAddress === exampleCompany.companyAddress)) {
    throw new Error("Replace the example companyCvr and companyAddress in app.config.ts before the public production build");
  }
  const { data, body } = parseFrontMatter(readFileSync(path.join(contentDirectory, `${slug}.md`), "utf8"));
  const effective = effectiveDate(data.effective);
  const values = {
    variables: {
      APP_NAME: config.appName,
      COMPANY_NAME: config.companyName,
      COMPANY_CVR: config.companyCvr,
      COMPANY_ADDRESS: config.companyAddress,
      SUPPORT_EMAIL: config.supportEmail,
      APP_URL: new URL(appUrl).origin,
      EFFECTIVE_DATE: effective,
    },
    blocks,
    flags: { ANALYTICS: analyticsServices.length > 0 },
  };
  const markdown = renderTemplate(body, values);
  return {
    title: required(data.title, "title"),
    // Used for search results and link previews; variables work here too.
    description: renderTemplate(required(data.description, "description"), values),
    version: version(data.version),
    effectiveDate: effective,
    markdown,
  };
}
