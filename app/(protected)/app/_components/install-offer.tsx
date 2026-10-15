"use client";

import { useSession, useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { toast } from "sonner";
import { appConfig } from "@/app.config";
import { useInstallPrompt } from "@/components/pwa/use-install-prompt";
import { installOfferDone, isSignUpSession, markInstallOfferDone } from "@/lib/pwa/install-offer";

const TOAST_ID = "install-offer";

// Offers to install the app once, when sign-up first brings the user here in a browser
// that can install it. Dismissing or answering it settles it for this browser; the
// profile menu keeps offering it while the browser can install.
export function InstallOffer() {
  const { user } = useUser();
  const { session } = useSession();
  const { canInstall, install } = useInstallPrompt();
  const offer = canInstall && !!user && !!session && isSignUpSession(user.createdAt, session.createdAt);

  useEffect(() => {
    if (!offer || installOfferDone()) return;
    toast(`Install ${appConfig.appName}`, {
      id: TOAST_ID,
      description: "Open it from your home screen, like any other app.",
      duration: Infinity,
      action: { label: "Install app", onClick: () => void install() },
      onDismiss: markInstallOfferDone,
    });
  }, [offer, install]);

  return null;
}
