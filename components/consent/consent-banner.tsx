"use client";

import { useEffect, useRef, useState } from "react";
import { appConfig } from "@/app.config";
import { Link } from "@/components/typography/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allChoices } from "@/lib/consent/cookie";
import { saveConsent, useConsentState } from "./consent-provider";
import { CookiePreferences } from "./cookie-preferences";
import styles from "./consent-banner.module.css";

// Shown after hydration until the user makes a choice, or again once it expires or the
// policy version changes. It never blocks the page; a spacer keeps the end of the page
// scrollable above it.
export function ConsentBanner() {
  const consent = useConsentState();
  if (consent !== null) return null;
  return <Banner />;
}

function Banner() {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const bannerRef = useRef<HTMLElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const banner = bannerRef.current;
    const spacer = spacerRef.current;
    if (!banner || !spacer) return;
    const observer = new ResizeObserver(() => { spacer.style.height = `${banner.offsetHeight}px`; });
    observer.observe(banner);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={spacerRef} aria-hidden="true" />
      <section ref={bannerRef} aria-labelledby="consent-banner-title" className={styles.banner}>
        <div className={styles.card}>
          <Card size="sm">
            <CardContent>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
                <p className="text-muted-foreground">
                  <span id="consent-banner-title" role="heading" aria-level={2} className="font-medium text-foreground">
                    Cookies on {appConfig.appName}.
                  </span>{" "}
                  We use essential cookies to keep you signed in and, with your permission, analytics to find and fix
                  errors. You can change your choice at any time. <Link href="/cookies">Cookie Policy</Link>
                </p>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPreferencesOpen(true)}>Customize</Button>
                  <Button size="sm" onClick={() => saveConsent(allChoices(false))}>Reject all</Button>
                  <Button size="sm" onClick={() => saveConsent(allChoices(true))}>Accept all</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
      <CookiePreferences open={preferencesOpen} onOpenChange={setPreferencesOpen} />
    </>
  );
}
