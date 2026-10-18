import { Pricing } from "@/components/billing/pricing";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { maintenanceMode } from "@/lib/maintenance";

export function LandingPricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-heading" className="flex scroll-mt-28 flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">Pricing</p>
        <h2 id="pricing-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Choose how you get started.</h2>
        <p className="max-w-xl leading-relaxed text-muted-foreground">Every plan includes the same Pro access. Choose a subscription or pay once for lifetime access.</p>
      </div>
      {maintenanceMode && (
        <Alert>
          <AlertTitle>Sign-ups and purchases are paused</AlertTitle>
          <AlertDescription>We’re making a few changes. Plans will be available again soon.</AlertDescription>
        </Alert>
      )}
      <Pricing onboarding disabled={maintenanceMode} />
      {!maintenanceMode && (
        <p className="text-sm leading-relaxed text-muted-foreground">Choose your plan, create an account, and complete checkout. Pro access starts after payment is confirmed.</p>
      )}
    </section>
  );
}
