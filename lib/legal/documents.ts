import { readFileSync } from "node:fs";
import path from "node:path";
import { appConfig, type AppConfig } from "../../app.config";
import { browserServices } from "../consent/services";
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

const analyticsServices = browserServices.filter((service) => service.category === "analytics");

function blocks(config: AppConfig) {
  return {
    "cookie-table": markdownTable(
      ["Name", "Provider", "Category", "Purpose", "Duration"],
      browserServices.flatMap((service) => service.storage.map((storage) => [
        `\`${storage.name}\` (${storage.kind.toLowerCase()})`,
        service.provider === "app" ? config.appName : service.provider,
        service.category === "essential" ? "Essential" : "Analytics",
        storage.purpose,
        storage.duration,
      ])),
    ),
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
}

// Pages call this while prerendering, so NEXT_PUBLIC_APP_URL must be set for every build.
export function loadLegalDocument(slug: LegalSlug, options: { config?: AppConfig; appUrl?: string } = {}) {
  const { config = appConfig, appUrl = process.env.NEXT_PUBLIC_APP_URL } = options;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is required to render the legal documents");
  const { data, body } = parseFrontMatter(readFileSync(path.join(contentDirectory, `${slug}.md`), "utf8"));
  const effective = effectiveDate(data.effective);
  const markdown = renderTemplate(body, {
    variables: {
      APP_NAME: config.appName,
      COMPANY_NAME: config.companyName,
      COMPANY_CVR: config.companyCvr,
      COMPANY_ADDRESS: config.companyAddress,
      SUPPORT_EMAIL: config.supportEmail,
      APP_URL: new URL(appUrl).origin,
      EFFECTIVE_DATE: effective,
    },
    blocks: blocks(config),
    flags: { ANALYTICS: analyticsServices.length > 0 },
  });
  return {
    title: required(data.title, "title"),
    description: required(data.description, "description"),
    version: version(data.version),
    effectiveDate: effective,
    markdown,
  };
}
