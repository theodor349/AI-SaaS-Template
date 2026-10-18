import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MisplacedSquare } from "./misplaced-square";
import { StatusMessage } from "./status-message";

// Shown in place of sign-up, sign-in, and every signed-in page while the app is
// paused (lib/maintenance.ts). The address stays the same, so reloading the page
// works once the app is back.
export function MaintenanceNotice() {
  return (
    <StatusMessage
      illustration={<MisplacedSquare variant="lifted" />}
      status="Paused for maintenance"
      heading="We’re making a few changes. Back soon."
      actions={
        <Button asChild size="lg">
          <Link href="/"><ArrowLeft aria-hidden="true" /> Back to home</Link>
        </Button>
      }
    >
      The app, sign-ups, and purchases are paused while we update things. Your account
      and data will be here when we’re back.
    </StatusMessage>
  );
}
