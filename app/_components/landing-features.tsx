import { CreditCard, Database, UserRound } from "lucide-react";

const features = [
  {
    icon: UserRound,
    title: "An account that’s yours",
    description: "Sign up and sign in with Clerk. Manage your profile and account from a dedicated settings page.",
  },
  {
    icon: Database,
    title: "A realtime foundation",
    description: "Next.js and Convex connect the interface to live data, with Shadcn and Tailwind providing the building blocks.",
  },
  {
    icon: CreditCard,
    title: "Paid access, connected",
    description: "Polar handles checkout and subscriptions. Manage your plan and billing from the customer portal.",
  },
];

export function LandingFeatures() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-28">
      <div className="mb-8 flex flex-col gap-3">
        <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">The project</p>
        <h2 id="features-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">The essentials, already in place.</h2>
        <p className="max-w-xl leading-relaxed text-muted-foreground">A shared foundation for AI SaaS projects, ready to shape around your own product.</p>
      </div>
      <div className="grid gap-8 border-y py-8 sm:grid-cols-3">
        {features.map(({ icon: Icon, title, description }) => (
          <article key={title} className="flex flex-col items-start gap-4">
            <Icon aria-hidden="true" size={24} strokeWidth={1.5} />
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
