import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

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
        <ClerkProvider>
          <TooltipProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </TooltipProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
