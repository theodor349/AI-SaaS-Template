import { consentCategories } from "@/lib/consent/categories";
import type { ConsentService, ConsentStorage } from "@/lib/consent/service";
import { consentServices } from "@/lib/consent/services";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const storageTypes: Record<ConsentStorage["type"], string> = {
  cookie: "Cookie",
  localStorage: "Local storage",
  sessionStorage: "Session storage",
};

// Generated from the consent service registry, so it lists exactly what the app can
// store. A service that stores nothing still gets a row.
export function CookieTable() {
  return (
    <section aria-labelledby="cookie-table-title" className="flex flex-col gap-3">
      <h2 id="cookie-table-title" className="text-xl font-semibold">Cookies and storage we use</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {consentServices.map((service) => <ServiceRows key={service.id} service={service} />)}
        </TableBody>
      </Table>
    </section>
  );
}

function ServiceRows({ service }: { service: ConsentService }) {
  const category = consentCategories[service.category].label;
  if (service.storage.length === 0) {
    return (
      <TableRow>
        <TableCell><span className="text-muted-foreground">None</span></TableCell>
        <TableCell>{service.name}</TableCell>
        <TableCell>{category}</TableCell>
        <TableCell><Wrapping>{service.purpose} Stores nothing in your browser.</Wrapping></TableCell>
        <TableCell>Not applicable</TableCell>
      </TableRow>
    );
  }
  return service.storage.map((item) => (
    <TableRow key={`${item.type}:${item.name}`}>
      <TableCell>
        <code>{item.name}</code>
        <span className="block text-muted-foreground">{storageTypes[item.type]}</span>
      </TableCell>
      <TableCell>{service.name}</TableCell>
      <TableCell>{category}</TableCell>
      <TableCell><Wrapping>{item.purpose}</Wrapping></TableCell>
      <TableCell><Wrapping>{item.duration}</Wrapping></TableCell>
    </TableRow>
  ));
}

// Table cells don't wrap; long text does, at a readable width.
function Wrapping({ children }: { children: React.ReactNode }) {
  return <span className="block min-w-40 whitespace-normal">{children}</span>;
}
