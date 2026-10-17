"use client";

import { useQuery } from "convex/react";
import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";
import { appConfig } from "@/app.config";
import { api } from "@/convex/_generated/api";
import { hasErrorCode } from "@/convex/lib/errors";
import { AuthBoundary, AuthPending } from "@/components/auth/auth-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, ButtonLabel } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentSkeleton, TextSkeleton } from "@/components/loading/content-skeleton";
import { useAction } from "@/lib/convex";
import { rateLimitMessage } from "@/lib/rate-limit";

const exportDescription =
  "Download a copy of your profile, billing history, and account requests as a JSON file.";

export function DataExport() {
  return (
    <AuthBoundary pending={<DataExportSkeleton />}>
      <DataExportContent />
    </AuthBoundary>
  );
}

function DataExportSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Export your data">
      <CardHeader>
        <CardTitle>Export your data</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="status" className="sr-only">
          Loading data export…
        </p>
        <div className="flex flex-col gap-4">
          <TextSkeleton>{exportDescription}</TextSkeleton>
          <div>
            <div className="w-fit">
              <ContentSkeleton>
                <Button disabled variant="outline">
                  <ButtonLabel loading={false} loadingText="Preparing export...">
                    Export data
                  </ButtonLabel>
                </Button>
              </ContentSkeleton>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Saves the export through a temporary object URL, so the file name is ours.
// Some browsers read the URL after click() returns, so it's revoked later.
function saveFile(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  const slug = appConfig.appName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  link.href = url;
  link.download = `${slug}-data-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function DataExportContent() {
  const current = useQuery(api.users.current);
  const download = useAction(api.dataExport.download);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runExport() {
    setIsExporting(true);
    setError(null);

    try {
      saveFile(await download({}));
    } catch (failure) {
      if (hasErrorCode(failure, "EXPORT_TOO_LARGE")) {
        setError(`Your data is too large to download here. Contact ${appConfig.supportEmail} for a copy.`);
      } else {
        setError(rateLimitMessage(failure) ?? "We couldn’t prepare your export. Try again in a moment.");
      }
    } finally {
      setIsExporting(false);
    }
  }

  function handleExport() {
    if (isExporting) {
      return;
    }

    void runExport();
  }

  if (!current || current.status === "provisioning") {
    return <AuthPending fallback={<DataExportSkeleton />} />;
  }

  return (
    <Card aria-label="Export your data">
      <CardHeader>
        <CardTitle>Export your data</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Couldn’t export your data</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <p>{exportDescription}</p>
          <div>
            <Button
              disabled={isExporting}
              variant="outline"
              onClick={handleExport}
              aria-busy={isExporting}
              aria-live="polite"
            >
              <ButtonLabel loading={isExporting} loadingText="Preparing export...">
                Export data
              </ButtonLabel>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
