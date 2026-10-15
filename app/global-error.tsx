"use client";

import { useEffect, useTransition } from "react";
import { appConfig } from "@/app.config";
import { reportError } from "@/lib/report-error";
import { useResolvedTheme } from "@/components/theme/use-theme";
import { MisplacedSquare } from "./_components/misplaced-square";
import styles from "./global-error.module.css";

// Errors in the root layout itself. This replaces the whole document, so it must not
// use Clerk, Convex, the navigation, or the global stylesheet: any of them may be what
// crashed. The home link is a full page load so the root layout starts over. Without the
// layout's theme script, a dark theme applies only once this page hydrates.
export default function GlobalError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [retrying, startRetry] = useTransition();
  const theme = useResolvedTheme();
  useEffect(() => reportError(error), [error]);

  return (
    <html lang="en" className={theme}>
      <body className={styles.body}>
        <title>{`Something went wrong — ${appConfig.appName}`}</title>
        <main className={styles.page}>
          <MisplacedSquare variant="popped" snapped={retrying} />
          <div className={styles.text}>
            <p className={styles.status}>Something went wrong</p>
            <h1 className={styles.heading}>Something broke. Just a little.</h1>
            <p className={styles.muted}>This page didn’t load. Try again, and if it keeps happening, let us know.</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.button} disabled={retrying} aria-busy={retrying} onClick={() => startRetry(retry)}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load re-runs the root layout. */}
            <a className={`${styles.button} ${styles.secondary}`} href="/">Back to home</a>
          </div>
          <p className={styles.muted}>
            Need a hand? Email <a href={`mailto:${appConfig.supportEmail}`}>{appConfig.supportEmail}</a>
            {error.digest && <> and mention reference <code>{error.digest}</code></>}.
          </p>
        </main>
      </body>
    </html>
  );
}
