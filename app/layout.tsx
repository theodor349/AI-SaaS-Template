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
import { siteUrl } from "@/lib/seo";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Defaults for every page. Public pages add their own title, description, and canonical
// URL, which Next copies into the Open Graph and Twitter tags. Pages must not set
// `openGraph` themselves: it would replace this one, dropping the generated image
// from opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: appConfig.appName, template: `%s — ${appConfig.appName}` },
  description: appConfig.description,
  applicationName: appConfig.appName,
  keywords: appConfig.keywords,
  openGraph: { type: "website", siteName: appConfig.appName, locale: "en" },
  twitter: { card: "summary_large_image", site: appConfig.socialHandle },
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
        <Toaster closeButton />
      </body>
    </html>
  );
}
