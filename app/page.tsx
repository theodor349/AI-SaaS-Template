import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingFeatures } from "./_components/landing-features";
import { LandingPricing } from "./_components/landing-pricing";

export const metadata: Metadata = {
  title: "AI SaaS Template — Your next idea starts here",
  description: "A foundation for your next AI product, with Next.js, realtime data, account management, and paid access. Choose monthly, yearly, or lifetime Pro access.",
};

export default function Home() {
  return (
    <div className="flex flex-col gap-20 sm:gap-28">
      <section aria-labelledby="hero-heading" className="grid items-center gap-12 py-8 sm:py-16 lg:grid-cols-2 lg:gap-20">
        <div className="flex flex-col items-start gap-7">
          <p className="flex items-center gap-2 text-xs font-medium tracking-widest uppercase text-muted-foreground">
            <Sparkles aria-hidden="true" size={16} /> AI SaaS Template
          </p>
          <h1 id="hero-heading" className="max-w-xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
            Your next idea starts here.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            A starting point for your next AI product. Built with Next.js and Convex,
            with account management and payments already connected, so you can focus
            on what makes your application useful.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="#pricing">Explore plans <ArrowRight aria-hidden="true" /></Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="#features">See what’s included <ArrowDown aria-hidden="true" /></Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">One product. Three ways to get Pro access.</p>
        </div>
        <GettingStarted />
      </section>
      <LandingFeatures />
      <LandingPricing />
      <footer className="flex flex-col justify-between gap-4 border-t pt-6 text-xs text-muted-foreground sm:flex-row">
        <p>AI SaaS Template · Built for your next project.</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-5">
          <Link href="/privacy" className="hover:text-foreground focus-visible:underline">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground focus-visible:underline">Terms</Link>
          <Link href="/cookies" className="hover:text-foreground focus-visible:underline">Cookies</Link>
        </nav>
      </footer>
    </div>
  );
}

function GettingStarted() {
  const steps = [
    { title: "Make it yours", description: "Choose a plan and create your account." },
    { title: "Complete checkout", description: "Pay securely with Polar for your selected plan." },
    { title: "You’re ready", description: "Open your dashboard once payment is confirmed." },
  ];
  return (
    <aside aria-label="Getting started" className="border border-border bg-muted/40 p-6 sm:p-8">
      <p className="mb-8 text-xs font-medium tracking-widest uppercase text-muted-foreground">From idea to a place to build</p>
      <ol className="flex flex-col gap-8">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center border border-border bg-background text-sm font-medium">0{index + 1}</span>
            <div className="flex flex-col gap-1">
              <h2 className="font-medium">{step.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-8 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground">
        <Check aria-hidden="true" size={16} /> Your account and billing, in one place.
      </p>
    </aside>
  );
}
