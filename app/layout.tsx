import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AUTHENTICATED_DESTINATION, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/auth";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "AI SaaS Template",
  description: "A Next.js, Convex, and Clerk starter.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </TooltipProvider>
        </ClerkProvider>
        <Toaster closeButton />
      </body>
    </html>
  );
}
