import { Check } from "lucide-react";
import { billingEnabled } from "@/convex/billing/plans";

const steps = billingEnabled
  ? [
    { title: "Make it yours", description: "Choose a plan and create your account." },
    { title: "Complete checkout", description: "Pay securely with Polar for your selected plan." },
    { title: "You’re ready", description: "Open your dashboard once payment is confirmed." },
  ]
  : [
    { title: "Make it yours", description: "Create your account." },
    { title: "You’re ready", description: "Open your dashboard and start building." },
  ];

export function GettingStarted() {
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
        <Check aria-hidden="true" size={16} /> {billingEnabled ? "Your account and billing, in one place." : "Your account, in one place."}
      </p>
    </aside>
  );
}
