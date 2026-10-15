import type { Metadata } from "next";
import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { appConfig } from "@/app.config";
import { BackLink } from "@/components/layout/back-link";
import { Link } from "@/components/typography/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadLegalDocument, type LegalSlug } from "@/lib/legal/documents";
import { publicPageMetadata } from "@/lib/seo";

export function legalMetadata(slug: LegalSlug): Metadata {
  const { title, description } = loadLegalDocument(slug);
  return publicPageMetadata({ title, description, path: `/${slug}` });
}

// Renders a document from content/legal on the server. Pages stay static and
// the document body ships no client JavaScript. `children` appear under the
// heading, for controls that belong with the document.
export function LegalDocument({ slug, children }: { slug: LegalSlug; children?: ReactNode }) {
  const document = loadLegalDocument(slug);
  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <BackLink href="/" label="Home" />
        <h1 className="text-3xl font-bold">{document.title}</h1>
        <p className="text-sm text-muted-foreground">Effective {document.effectiveDate} · Version {document.version}</p>
        <CompanyDetails />
      </header>
      {children}
      <div className="flex flex-col gap-4 leading-relaxed">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[labelTableCells]} components={components}>
          {document.markdown}
        </Markdown>
      </div>
    </article>
  );
}

// The Danish E-Commerce Act requires these details to be easy to find.
function CompanyDetails() {
  return (
    <address className="text-sm not-italic text-muted-foreground">
      {appConfig.companyName} · CVR {appConfig.companyCvr} · {appConfig.companyAddress} ·{" "}
      <Link href={`mailto:${appConfig.supportEmail}`}>{appConfig.supportEmail}</Link>
    </address>
  );
}

// Documents start at level-two headings; the page title comes from front matter.
const components: Components = {
  h2: ({ children }) => <h2 className="mt-4 text-xl font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 text-lg font-semibold">{children}</h3>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-6">{children}</ol>,
  a: ({ href = "", children }) => <Link href={href}>{children}</Link>,
  code: ({ children }) => <code className="rounded-sm bg-muted px-1 font-mono">{children}</code>,
  table: ({ children }) => <Table stack>{children}</Table>,
  thead: ({ children }) => <TableHeader stack>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody stack>{children}</TableBody>,
  tr: ({ children }) => <TableRow stack>{children}</TableRow>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  td: ({ children, node }) => <TableCell wrap label={String(node?.properties.dataLabel ?? "")}>{children}</TableCell>,
};

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function descendants(node: HastNode, tagName: string): HastNode[] {
  return (node.children ?? []).flatMap((child) => child.tagName === tagName ? [child] : descendants(child, tagName));
}

function text(node: HastNode): string {
  return node.type === "text" ? node.value ?? "" : (node.children ?? []).map(text).join("");
}

// Gives each body cell its column heading, so tables can stack into labelled
// rows on narrow screens.
function labelTableCells() {
  return (tree: HastNode) => {
    for (const table of descendants(tree, "table")) {
      const labels = descendants(table, "th").map(text);
      for (const row of descendants(table, "tr")) {
        descendants(row, "td").forEach((cell, index) => {
          cell.properties = { ...cell.properties, dataLabel: labels[index] };
        });
      }
    }
  };
}
