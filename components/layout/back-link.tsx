import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// The in-app way up from a page that isn't in the main navigation, which an installed
// app needs without a browser back button. It links to the page's logical parent instead
// of going back, so it also works on a page opened directly or from a shortcut.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="-ml-2.5 self-start">
      <Button asChild variant="ghost">
        <Link href={href} aria-label={`Back to ${label}`}>
          <ChevronLeft aria-hidden="true" /> {label}
        </Link>
      </Button>
    </div>
  );
}
