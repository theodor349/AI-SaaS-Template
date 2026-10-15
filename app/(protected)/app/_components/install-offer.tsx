"use client";

import { useSession, useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { toast } from "sonner";
import { appConfig } from "@/app.config";
import { useInstallPrompt } from "@/components/pwa/use-install-prompt";
import { installOfferDone, isSignUpSession, markInstallOfferDone } from "@/lib/pwa/install-offer";

const TOAST_ID = "install-offer";
// Whether the offer is on screen. The toast outlives this component, so this lives
// beside it, and it lets a dismissal by the code pass without settling the offer.
let showing = false;

// Offers to install the app once, when sign-up first brings the user here in a browser
// that can install it. Dismissing or answering it settles it for this browser; the
// profile menu keeps offering it while the browser can install.
export function InstallOffer() {
  const { user } = useUser();
  const { session } = useSession();
  const { canInstall, install } = useInstallPrompt();
  const offer = canInstall && !!user && !!session && isSignUpSession(user.createdAt, session.createdAt);

  useEffect(() => {
    // Installing from the profile menu, or the browser's own menu, leaves nothing to offer.
    if (!offer) {
      if (showing) {
        showing = false;
        toast.dismiss(TOAST_ID);
      }
      return;
    }
    if (installOfferDone()) return;
    showing = true;
    toast(`Install ${appConfig.appName}`, {
      id: TOAST_ID,
      description: "Open it from your home screen, like any other app.",
      duration: Infinity,
      action: { label: "Install app", onClick: () => void install() },
      // Sonner calls this for the close button, a swipe, and toast.dismiss() alike.
      onDismiss: () => {
        if (!showing) return;
        showing = false;
        markInstallOfferDone();
      },
    });
  }, [offer, install]);

  return null;
}
