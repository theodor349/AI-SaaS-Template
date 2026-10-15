"use client";

import { useEffect, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { appConfig } from "@/app.config";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/report-error";
import { MisplacedSquare } from "./_components/misplaced-square";
import { StatusMessage } from "./_components/status-message";
import { HomeLink } from "./_components/home-link";

// Errors below the root layout. Only the digest is shown; Next strips server error
// messages in production, and client error messages may still hold internal details.
export default function PageError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [retrying, startRetry] = useTransition();
  useEffect(() => reportError(error), [error]);

  return (
    <>
      <title>{`Something went wrong — ${appConfig.appName}`}</title>
      <meta name="robots" content="noindex" />
      <StatusMessage
        illustration={<MisplacedSquare variant="popped" snapped={retrying} />}
        status="Something went wrong"
        heading="Something broke. Just a little."
        reference={error.digest}
        actions={<>
          <Button size="lg" disabled={retrying} aria-busy={retrying} onClick={() => startRetry(retry)}>
            <RotateCcw aria-hidden="true" /> Try again
          </Button>
          <HomeLink variant="outline" />
        </>}
      >
        This page didn’t load. Try again, and if it keeps happening, let us know.
      </StatusMessage>
    </>
  );
}
