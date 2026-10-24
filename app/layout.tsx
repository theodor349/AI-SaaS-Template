import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AUTHENTICATED_DESTINATION, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/auth";
import { SiteNavigation } from "@/components/layout/site-navigation";
import { PageContent } from "@/components/layout/page-content";
import { ConnectionStatus } from "@/components/layout/connection-status";
import navigationStyles from "@/components/layout/site-navigation.module.css";
import { appConfig, type AppConfig } from "@/app.config";
import { throwIfE2ECrashRequested } from "@/lib/e2e-crash";
import { openGraphDefaults, siteUrl } from "@/lib/seo";
import { ConsentProvider } from "@/components/consent/consent-provider";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { ConsentServices } from "@/components/consent/consent-services";
import { themeScript } from "@/lib/theme";
import { ThemeSync } from "@/components/theme/theme-sync";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout instead of covering form fields and the
  // bottom navigation.
  interactiveWidget: "resizes-content",
  // No `themeColor`: the theme script sets theme-color to the chosen theme before first
  // paint. React re-renders viewport tags on client navigation and drops the script's tag,
  // so a light and dark pair here would override an explicit choice of the other theme.
};

const title = { default: appConfig.appName, template: `%s — ${appConfig.appName}` };
// Read through AppConfig: an optional field left out of appConfig is missing from its inferred type.
const { keywords }: AppConfig = appConfig;

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title,
  description: appConfig.description,
  keywords,
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
    // The theme script sets the theme class and color scheme on <html> before first paint.
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeSync />
        <ServiceWorkerRegistration />
        <ConsentProvider>
          <ClerkProvider
            appearance={{ theme: shadcn }}
            signInUrl={SIGN_IN_PATH}
            signUpUrl={SIGN_UP_PATH}
            signInFallbackRedirectUrl={AUTHENTICATED_DESTINATION}
            signUpFallbackRedirectUrl={AUTHENTICATED_DESTINATION}
            allowedRedirectOrigins={[]}
          >
            <TooltipProvider>
              <ConvexClientProvider>
                <SiteNavigation />
                <ConnectionStatus />
                <main className={cn("container mx-auto max-w-6xl px-4 py-8 sm:px-8", navigationStyles.content)}>
                  <PageContent>{children}</PageContent>
                </main>
              </ConvexClientProvider>
            </TooltipProvider>
          </ClerkProvider>
          <ConsentBanner />
          <ConsentServices />
        </ConsentProvider>
        <Toaster closeButton offset={{ bottom: "var(--toast-offset-bottom, 24px)" }}
          mobileOffset={{ bottom: "var(--toast-offset-bottom, 16px)" }} />
      </body>
    </html>
  );
}
