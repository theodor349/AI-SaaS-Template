import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AUTHENTICATED_DESTINATION, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/auth";
import { SiteNavigation } from "@/components/layout/site-navigation";
import { PageContent } from "@/components/layout/page-content";
import navigationStyles from "@/components/layout/site-navigation.module.css";
import { appConfig } from "@/app.config";
import { throwIfE2ECrashRequested } from "@/lib/e2e-crash";
import { openGraphDefaults, siteUrl } from "@/lib/seo";
import { ConsentProvider } from "@/components/consent/consent-provider";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { ConsentServices } from "@/components/consent/consent-services";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const title = { default: appConfig.appName, template: `%s — ${appConfig.appName}` };

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title,
  description: appConfig.description,
  openGraph: { ...openGraphDefaults, title, description: appConfig.description },
  twitter: { card: "summary_large_image", site: appConfig.xHandle ?? undefined },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await throwIfE2ECrashRequested("layout");
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <ConsentProvider>
          <ClerkProvider
            signInUrl={SIGN_IN_PATH}
            signUpUrl={SIGN_UP_PATH}
            signInFallbackRedirectUrl={AUTHENTICATED_DESTINATION}
            signUpFallbackRedirectUrl={AUTHENTICATED_DESTINATION}
            allowedRedirectOrigins={[]}
          >
            <TooltipProvider>
              <ConvexClientProvider>
                <SiteNavigation />
                <main className={cn("container mx-auto max-w-6xl px-4 py-8 sm:px-8", navigationStyles.content)}>
                  <PageContent>{children}</PageContent>
                </main>
              </ConvexClientProvider>
            </TooltipProvider>
          </ClerkProvider>
          <ConsentBanner />
          <ConsentServices />
        </ConsentProvider>
        <Toaster closeButton />
      </body>
    </html>
  );
}
