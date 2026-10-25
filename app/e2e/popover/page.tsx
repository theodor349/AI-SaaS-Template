import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// E2E-only page for overlay history tests, since no template page uses a Popover yet; a 404 everywhere else.
export default function E2EPopoverPage() {
  if (process.env.E2E_TEST_ROUTES !== "1") notFound();
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Popover test page</h1>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">Open popover</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Test popover">The popover is open.</PopoverContent>
      </Popover>
    </>
  );
}
