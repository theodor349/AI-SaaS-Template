import type { ReactNode } from "react";
import { appConfig } from "@/app.config";

// The shared body of the 404 and error pages. `status` states plainly what happened
// for anyone who skims; the heading can afford to be playful.
export function StatusMessage({ illustration, status, heading, children, actions, reference }: {
  illustration: ReactNode;
  status: string;
  heading: string;
  children: ReactNode;
  actions: ReactNode;
  reference?: string;
}) {
  return (
    <section aria-labelledby="status-heading" className="flex flex-col items-center gap-8 py-12 text-center sm:py-20">
      {illustration}
      <div className="flex flex-col items-center gap-3">
        <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">{status}</p>
        <h1 id="status-heading" className="max-w-xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {heading}
        </h1>
        <p className="max-w-md text-muted-foreground text-pretty">{children}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">{actions}</div>
      <p className="max-w-md text-sm text-muted-foreground text-pretty">
        Need a hand? Email{" "}
        <a href={`mailto:${appConfig.supportEmail}`} className="font-medium text-foreground underline underline-offset-4">
          {appConfig.supportEmail}
        </a>
        {reference && <> and mention reference <code className="font-mono text-foreground">{reference}</code></>}.
      </p>
    </section>
  );
}
