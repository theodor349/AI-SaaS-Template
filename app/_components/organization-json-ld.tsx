import { appConfig } from "@/app.config";
import { siteUrl } from "@/lib/seo";

// The company behind the app, as schema.org structured data for search engines.
export function OrganizationJsonLd() {
  const { companyName, supportEmail, organization } = appConfig;
  const appUrl = siteUrl().href;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: companyName,
    url: organization.url ?? appUrl,
    email: supportEmail,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: supportEmail },
    ...(organization.sameAs.length > 0 && { sameAs: organization.sameAs }),
  };
  // Escaping "<" keeps config text from closing the script element early.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}
