import { LegalDocument, legalMetadata } from "../_components/legal-document";

export const metadata = legalMetadata("terms");

export default function TermsPage() {
  return <LegalDocument slug="terms" />;
}
