import { appConfig } from "@/app.config";
import { siteUrl } from "@/lib/seo";

// Organization structured data that search engines read for the company's name,
// logo, contact, and profiles.
export function OrganizationSchema() {
  const url = siteUrl();
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: appConfig.companyName,
    url: url.href,
    logo: new URL("/icon.svg", url).href,
    email: appConfig.supportEmail,
    sameAs: appConfig.socialProfiles,
  };
  // Escaping "<" keeps config text from closing the script element.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organization).replaceAll("<", "\\u003c") }}
    />
  );
}
