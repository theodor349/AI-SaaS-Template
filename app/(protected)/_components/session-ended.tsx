import { SignInButton } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTHENTICATED_DESTINATION } from "@/lib/auth";
import { HomeLink } from "../../_components/home-link";
import { MisplacedSquare } from "../../_components/misplaced-square";
import { StatusMessage } from "../../_components/status-message";

// Replaces a signed-in page when its session ends while the page is open, such as
// after signing out in another tab. Signing in comes back to the same address.
export function SessionEnded() {
  return (
    <StatusMessage
      illustration={<MisplacedSquare variant="away" />}
      status="Session ended"
      heading="You’ve been signed out."
      actions={<>
        <SignInButton fallbackRedirectUrl={AUTHENTICATED_DESTINATION}>
          <Button size="lg"><LogIn aria-hidden="true" /> Sign in</Button>
        </SignInButton>
        <HomeLink variant="outline" />
      </>}
    >
      Sessions end after a long time away, or when you sign out in another tab or on
      another device. Sign in to pick up where you left off.
    </StatusMessage>
  );
}
